"""
图片超分（PyTorch + CUDA 版）。

为什么不用 ONNX：实测 ONNX Runtime 在 DirectML 上跑 RRDB 架构反而比 CPU 还慢
（220-280s），因为 RRDB 由 23 个残差块 × 5 层小卷积组成，逐算子 dispatch 的
开销吃光了计算收益。PyTorch 的卷积融合和显存规划好得多，同一个模型能快一个数量级。

模型结构：RRDBNet（Real-ESRGAN / UltraSharp 系列通用架构）
权重：RealESRGAN_x4plus.pth（67MB，4x）

用法：
    python upscale_torch.py 输入.png [输出.png]
    python upscale_torch.py 输入.png 输出.png --tile 256   # 显存紧张时手动分块
"""

import os
import sys
import time

# 仓库根目录（本文件所在目录）。权重和缓存都以它为基准，换盘不用改代码。
_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("HF_HOME", os.path.join(_REPO_ROOT, "hf-cache"))

import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

# 超分权重目录，可用 MOSS_UPSCALE_DIR 覆盖
MODEL_DIR = os.environ.get("MOSS_UPSCALE_DIR", "").strip() or os.path.join(
    _REPO_ROOT, "models", "upscale"
)
DEFAULT_WEIGHTS = os.path.join(MODEL_DIR, "RealESRGAN_x4plus.pth")


# ---------------------------------------------------------------- 网络结构


class ResidualDenseBlock(nn.Module):
    """RRDB 里的稠密连接块：每层都吃前面所有层的输出。"""

    def __init__(self, num_feat: int = 64, num_grow_ch: int = 32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    """Residual in Residual Dense Block。"""

    def __init__(self, num_feat: int, num_grow_ch: int = 32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    """Real-ESRGAN 的生成器主体。"""

    def __init__(
        self,
        num_in_ch: int = 3,
        num_out_ch: int = 3,
        scale: int = 4,
        num_feat: int = 64,
        num_block: int = 23,
        num_grow_ch: int = 32,
    ):
        super().__init__()
        self.scale = scale
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


# ---------------------------------------------------------------- 推理


def load_model(weights: str, device: torch.device) -> RRDBNet:
    model = RRDBNet()
    state = torch.load(weights, map_location="cpu", weights_only=True)
    for key in ("params_ema", "params", "state_dict"):
        if isinstance(state, dict) and key in state:
            state = state[key]
            break
    # 有些权重带 module. 前缀，去掉
    state = {k.removeprefix("module."): v for k, v in state.items()}
    model.load_state_dict(state, strict=True)
    model.eval()
    model = model.to(device)
    if device.type == "cuda":
        model = model.half()  # fp16 省一半显存
    return model


@torch.inference_mode()
def upscale_whole(model: RRDBNet, img: Image.Image, device: torch.device) -> Image.Image:
    arr = torch.from_numpy(_to_array(img)).permute(2, 0, 1).unsqueeze(0)
    arr = arr.to(device)
    if device.type == "cuda":
        arr = arr.half()
    out = model(arr)
    out = out.float().clamp(0, 1)[0].permute(1, 2, 0).cpu().numpy()
    return Image.fromarray((out * 255).round().astype("uint8"))


@torch.inference_mode()
def upscale_tiled(
    model: RRDBNet,
    img: Image.Image,
    device: torch.device,
    tile: int = 256,
    overlap: int = 16,
    scale: int = 4,
) -> Image.Image:
    """显存不够时按块放大，块之间用羽化权重拼接避免接缝。"""
    src = _to_array(img)
    h, w, _ = src.shape
    dst = __import__("numpy").zeros((h * scale, w * scale, 3), dtype="float32")
    weight = __import__("numpy").zeros((h * scale, w * scale, 1), dtype="float32")

    step = max(1, tile - overlap * 2)
    boxes: list[tuple[int, int, int, int]] = []
    # 注意：这里用 for + range 推进，不要用 while 手动改循环变量，
    # 否则贴边回拉时会原地打转（曾经因此死循环把内存吃爆）。
    for y0 in range(0, h, step):
        y1 = min(y0 + tile, h)
        sy = max(0, y1 - tile)
        for x0 in range(0, w, step):
            x1 = min(x0 + tile, w)
            sx = max(0, x1 - tile)
            boxes.append((sy, y1, sx, x1))
    # 贴边回拉会产生重复块，去重避免重复计算
    boxes = list(dict.fromkeys(boxes))

    total = len(boxes)
    for i, (y0, y1, x0, x1) in enumerate(boxes, 1):
        patch = torch.from_numpy(src[y0:y1, x0:x1, :]).permute(2, 0, 1).unsqueeze(0).to(device)
        if device.type == "cuda":
            patch = patch.half()
        out = model(patch).float().clamp(0, 1)[0].permute(1, 2, 0).cpu().numpy()

        ph, pw = out.shape[:2]
        wy = __import__("numpy").hanning(max(2, ph))[:, None]
        wx = __import__("numpy").hanning(max(2, pw))[None, :]
        wgt = (wy * wx)[:, :, None].astype("float32")

        dy, dx = y0 * scale, x0 * scale
        dst[dy : dy + ph, dx : dx + pw, :] += out * wgt
        weight[dy : dy + ph, dx : dx + pw, :] += wgt
        print(f"    块 {i}/{total}  ({x1 - x0}x{y1 - y0} -> {pw}x{ph})")

    dst = dst / __import__("numpy").maximum(weight, 1e-6)
    return Image.fromarray((dst.clip(0, 1) * 255).round().astype("uint8"))


def _to_array(img: Image.Image):
    import numpy as np

    return np.asarray(img.convert("RGB"), dtype="float32") / 255.0


def upscale_to(
    img: Image.Image,
    model: RRDBNet,
    device: torch.device,
    target_edge: int = 0,
    tile: int = 384,
) -> Image.Image:
    """放大 4 倍，然后按需缩到目标长边（例如 4K 的 3840）。

    target_edge=0 表示不缩放，保留 4x 原始尺寸。
    走分块模式，显存恒定在 1.2GB 左右，不受输入尺寸影响。
    """
    result = upscale_tiled(model, img, device, tile)
    if target_edge > 0:
        w, h = result.size
        long_edge = max(w, h)
        if long_edge != target_edge:
            ratio = target_edge / long_edge
            result = result.resize((round(w * ratio), round(h * ratio)), Image.LANCZOS)
    return result


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1

    src_path = argv[1]
    out_path = None
    tile = 384  # 默认分块：显存恒定 ~1.2GB，不受输入尺寸影响
    max_edge = 0  # 0 = 保留 4x 原始尺寸
    weights = DEFAULT_WEIGHTS

    args = argv[2:]
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--tile" and i + 1 < len(args):
            tile = int(args[i + 1])
            i += 2
        elif a == "--max-edge" and i + 1 < len(args):
            max_edge = int(args[i + 1])
            i += 2
        elif a == "--weights" and i + 1 < len(args):
            weights = args[i + 1]
            i += 2
        elif a == "--whole":
            tile = 0  # 强制整图模式（小图更快，大图会吃满显存）
            i += 1
        else:
            out_path = a
            i += 1

    if not os.path.exists(weights):
        print(f"权重不存在: {weights}")
        return 1

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    img = Image.open(src_path)
    print(f"输入: {src_path}")
    print(f"  尺寸: {img.size[0]}x{img.size[1]}")
    print(f"设备: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""))
    print(f"权重: {os.path.basename(weights)}")

    t_load = time.time()
    model = load_model(weights, device)
    print(f"  加载: {time.time() - t_load:.1f}s")

    if not out_path:
        out_path = f"{os.path.splitext(src_path)[0]}_x4.png"

    t0 = time.time()
    try:
        if tile == 0:
            result = upscale_whole(model, img, device)
        else:
            result = upscale_tiled(model, img, device, tile)
    except torch.cuda.OutOfMemoryError:
        print("  ⚠ 显存不足，自动切到分块模式（tile=384）")
        torch.cuda.empty_cache()
        result = upscale_tiled(model, img, device, 384)

    if max_edge > 0:
        w, h = result.size
        long_edge = max(w, h)
        if long_edge != max_edge:
            ratio = max_edge / long_edge
            result = result.resize((round(w * ratio), round(h * ratio)), Image.LANCZOS)
            print(f"  缩放到目标长边 {max_edge}")
    elapsed = time.time() - t0

    result.save(out_path)
    print()
    print(f"输出: {out_path}")
    print(f"  尺寸: {result.size[0]}x{result.size[1]}")
    print(f"  大小: {os.path.getsize(out_path) / 1024:,.0f} KB")
    print(f"  耗时: {elapsed:.1f} 秒")

    if device.type == "cuda":
        alloc = torch.cuda.max_memory_allocated() / 1024**3
        print(f"  显存峰值: {alloc:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
