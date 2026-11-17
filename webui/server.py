"""
MOSS-Image 的 OpenAI 兼容服务。

把只能跑在 Python 里的 MOSS-Image（DiffSynth-Studio）包装成标准 OpenAI 生图接口，
AIGC 创作台把它当供应商填进去就能用，平台代码零改动。

接口：
    GET  /                     -> 服务说明
    GET  /health               -> 健康检查
    GET  /v1/models            -> 模型清单（带 type:"image"，平台靠它分类）
    POST /v1/images/generations-> 文生图，返回 {"data":[{"b64_json": ...}]}

不做的事：
    - /v1/images/edits 返回 501：MOSS-Image 没有图像条件输入，不能改图
    - 不实现 stream：平台的流式只对 gpt-image 系列开启

环境变量：
    MOSS_TURBO_LORA     4 步加速 LoRA 路径；配了才出现 turbo 模型
    MOSS_NSFW_LORA      额外风格 LoRA 路径；配了才出现 -nsfw 模型变体
    MOSS_MAX_EDGE       长边上限，默认 768
    MOSS_MOCK=1         不加载模型，返回占位图
    MOSS_API_KEY        配了就校验 Authorization
    MOSS_PORT           默认 8188
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import threading
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("moss")

# 仓库根目录：webui/ 的上一级。所有路径都以它为基准，换盘/换机器不用改代码。
# 需要单独指定时（比如权重放在别的盘），设环境变量 MOSS_HOME 覆盖。
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOSS_HOME = os.environ.get("MOSS_HOME", "").strip() or _REPO_ROOT

# 权重和缓存统一放仓库根目录下
os.environ.setdefault("HF_HOME", os.path.join(MOSS_HOME, "hf-cache"))
os.environ.setdefault("DIFFSYNTH_MODEL_BASE_PATH", os.path.join(MOSS_HOME, "models"))

# 超分权重目录（RealESRGAN_x4plus.pth 所在处）
UPSCALE_DIR = os.environ.get("MOSS_UPSCALE_DIR", "").strip() or os.path.join(
    MOSS_HOME, "models", "upscale"
)

QUANT_REPO = "DiffSynth-Studio/MOSS-Image-EntroPack"
BASE_REPO = "OpenMOSS-Team/MOSS-Image-SFT"
DIT_PACKAGE = os.environ.get("MOSS_DIT_PACKAGE", "models/MOSS-Image-SFT/dit_4.5bit.safetensors")
TE_PACKAGE = os.environ.get("MOSS_TE_PACKAGE", "models/text_encoder_4.5bit.safetensors")
MAX_EDGE = int(os.environ.get("MOSS_MAX_EDGE", "768"))
TURBO_LORA = os.environ.get("MOSS_TURBO_LORA", "").strip()
NSFW_LORA = os.environ.get("MOSS_NSFW_LORA", "").strip()
MOCK = os.environ.get("MOSS_MOCK", "").strip() in {"1", "true", "yes"}
API_KEY = os.environ.get("MOSS_API_KEY", "").strip()
PORT = int(os.environ.get("MOSS_PORT", "8188"))
# 超分：生成完自动放大到目标长边（4K = 3840，正好是 960 的 4 倍）
UPSCALE = os.environ.get("MOSS_UPSCALE", "").strip() in {"1", "true", "yes"}
UPSCALE_TARGET = int(os.environ.get("MOSS_UPSCALE_TARGET", "3840"))
# 超分流程里基础图的最小长边：低于这个尺寸，基础图本身就缺细节，超分只是在放大糊图
MIN_GEN_EDGE = int(os.environ.get("MOSS_MIN_GEN_EDGE", "512"))

# 显卡只有一块，生图必须排队
GPU_LOCK = threading.Lock()

_pipe: Any = None
_pipe_lock = threading.Lock()
_load_error: str | None = None
# 当前已挂上的 LoRA 集合，用于判断是否需要切换
_loaded_loras: frozenset[str] = frozenset()
# 超分模型（懒加载，只在开了 MOSS_UPSCALE 时用）
_upscaler: Any = None
_upscaler_lock = threading.Lock()

# 模型 id -> (步数, cfg, 需要的 LoRA 元组, 是否后超分)
# 带 -up 后缀的变体：先按 size/4 生成基础图，再超分到 size 指定的目标尺寸。
# 用后缀而不是加请求参数，是因为 OpenAI 协议不接受自定义字段，
# 这样平台侧只要切换 modelId 就能控制，schema 和 SDK 都不用动。
BASE_MODELS: dict[str, tuple[int, float, tuple[str, ...]]] = {
    "moss-image-sft": (50, 3.0, ()),
}
if NSFW_LORA:
    BASE_MODELS["moss-image-sft-nsfw"] = (50, 3.0, (NSFW_LORA,))
if TURBO_LORA:
    BASE_MODELS["moss-image-sft-turbo"] = (4, 1.0, (TURBO_LORA,))
    if NSFW_LORA:
        BASE_MODELS["moss-image-sft-turbo-nsfw"] = (4, 1.0, (TURBO_LORA, NSFW_LORA))

MODELS: dict[str, tuple[int, float, tuple[str, ...], bool]] = {
    name: (*cfg, False) for name, cfg in BASE_MODELS.items()
}
# 超分模型文件存在时才提供 -up 变体
_UPSCALE_WEIGHTS = os.path.join(UPSCALE_DIR, "RealESRGAN_x4plus.pth")
UPSCALE_AVAILABLE = os.path.isfile(_UPSCALE_WEIGHTS)
if UPSCALE_AVAILABLE:
    for name, cfg in BASE_MODELS.items():
        MODELS[f"{name}-up"] = (*cfg, True)


# ---------------------------------------------------------------- 模型加载


def _register_prequantized(pattern: str, **vram_cfg):
    """下载量化包和 json 配置，注册进 DiffSynth 的 MODEL_CONFIGS。

    量化包必须连同 .json sidecar 一起注册，否则 DiffSynth 不知道按什么精度反量化。

    vram_cfg 必须传：不传的话 DiffSynth 用默认策略把权重尽量往 GPU 塞，
    6GB 卡会塞满显存，每步计算都要来回换入换出，实测慢 10 倍。
    """
    from diffsynth.configs import MODEL_CONFIGS
    from diffsynth.pipelines.moss_image import ModelConfig

    package = ModelConfig(model_id=QUANT_REPO, origin_file_pattern=pattern, **vram_cfg)
    package.download_if_necessary()

    sidecar = ModelConfig(
        model_id=QUANT_REPO,
        origin_file_pattern=pattern.replace(".safetensors", ".json"),
    )
    sidecar.download_if_necessary()
    with open(sidecar.path, encoding="utf-8") as handle:
        entry = json.load(handle)

    if not any(cfg.get("model_hash") == entry.get("model_hash") for cfg in MODEL_CONFIGS):
        MODEL_CONFIGS.append(entry)
    return package


def load_pipe():
    """懒加载主模型。LoRA 不在这里挂，由 ensure_loras 按请求切换。"""
    global _pipe, _load_error
    if _pipe is not None:
        return _pipe
    with _pipe_lock:
        if _pipe is not None:
            return _pipe
        try:
            import torch
            from diffsynth.pipelines.moss_image import MOSSImagePipeline, ModelConfig

            if not torch.cuda.is_available():
                raise RuntimeError("torch 看不到 CUDA，检查是不是装成了 CPU 版")

            # 6GB 卡必须显式指定 offload 策略：权重常驻 CPU 内存，计算时按层搬进显存。
            # 不传这些，DiffSynth 默认会把权重尽量塞进 GPU，塞满后每步都要来回换入换出，
            # 实测比按层搬运慢 10 倍（768² 4 步 180 秒 vs 25 秒）。
            vram = {
                "offload_dtype": torch.bfloat16,
                "offload_device": "cpu",
                "onload_dtype": torch.bfloat16,
                "onload_device": "cpu",
                "preparing_dtype": torch.bfloat16,
                "preparing_device": "cuda",
                "computation_dtype": torch.bfloat16,
                "computation_device": "cuda",
            }
            vae_vram = {
                **vram,
                "offload_dtype": torch.float32,
                "onload_dtype": torch.float32,
                "preparing_dtype": torch.float32,
                "computation_dtype": torch.float32,
            }

            log.info("加载量化包: DiT=%s  TE=%s", DIT_PACKAGE, TE_PACKAGE)
            _pipe = MOSSImagePipeline.from_pretrained(
                torch_dtype=torch.bfloat16,
                device="cuda",
                model_configs=[
                    _register_prequantized(DIT_PACKAGE, **vram),
                    _register_prequantized(TE_PACKAGE, **vram),
                    ModelConfig(
                        model_id=BASE_REPO,
                        origin_file_pattern="vae/diffusion_pytorch_model.safetensors",
                        **vae_vram,
                    ),
                ],
                tokenizer_config=ModelConfig(model_id=BASE_REPO, origin_file_pattern="tokenizer/"),
            )
            _load_error = None
            log.info("主模型加载完成")
        except Exception as exc:  # noqa: BLE001
            _load_error = f"{type(exc).__name__}: {exc}"
            log.exception("模型加载失败")
            raise
    return _pipe


def ensure_loras(wanted: tuple[str, ...]) -> None:
    """确保当前挂载的 LoRA 与请求的模型匹配。

    DiffSynth 的 LoRA 是就地打补丁，切换组合要先 clear 再逐个 load。
    单个 LoRA 加载约 2-3 秒，切换代价可接受。
    """
    global _loaded_loras
    want = frozenset(wanted)
    if want == _loaded_loras:
        return

    pipe = load_pipe()
    if _loaded_loras:
        log.info("切换 LoRA，先清空当前 %d 个", len(_loaded_loras))
        pipe.clear_lora()

    for path in wanted:
        log.info("加载 LoRA: %s", os.path.basename(path))
        pipe.load_lora(pipe.dit, path)
    _loaded_loras = want


def get_upscaler():
    """懒加载超分模型（RRDBNet / RealESRGAN_x4plus）。

    只在 MOSS_UPSCALE=1 时才会走到这里。分块推理，显存恒定约 1.2GB，
    和 MOSS 生成用的 1.4GB 串行执行，6GB 卡能共存。
    """
    global _upscaler
    if _upscaler is not None:
        return _upscaler
    with _upscaler_lock:
        if _upscaler is not None:
            return _upscaler
        import sys

        import torch

        sys.path.insert(0, MOSS_HOME)
        from upscale_torch import load_model as load_sr

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        weights = os.path.join(UPSCALE_DIR, "RealESRGAN_x4plus.pth")
        model = load_sr(weights, device)
        _upscaler = (model, device)
        log.info("超分模型加载完成: %s (%s)", os.path.basename(weights), device)
    return _upscaler


def apply_upscale(image, target_edge: int = 0):
    """把生成的图放大到目标长边。失败时原样返回，不让超分拖垮整条生图链路。"""
    if not UPSCALE_AVAILABLE:
        return image
    try:
        import sys

        import torch

        sys.path.insert(0, MOSS_HOME)
        from upscale_torch import upscale_to

        model, device = get_upscaler()
        if device.type == "cuda":
            torch.cuda.empty_cache()  # 生成后的激活值先还给显存
        t = time.time()
        out = upscale_to(image, model, device, target_edge=target_edge or UPSCALE_TARGET)
        log.info("超分完成 %dx%d -> %dx%d 用时 %.1fs", *image.size, *out.size, time.time() - t)
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("超分失败，返回原图: %s: %s", type(exc).__name__, exc)
        return image


# ---------------------------------------------------------------- 工具


def parse_size(size: str | None) -> tuple[int, int] | None:
    """解析 "1024x768" 形式的尺寸，非法返回 None。"""
    if not size or size.strip().lower() in {"auto", ""}:
        return None
    raw = size.strip().lower().replace("×", "x")
    try:
        w_s, h_s = raw.split("x", 1)
        w, h = int(float(w_s)), int(float(h_s))
    except Exception:  # noqa: BLE001
        return None
    if w <= 0 or h <= 0:
        return None
    return w, h


def fit_edge(w: int, h: int, max_edge: int) -> tuple[int, int]:
    """等比缩到长边不超过 max_edge，并对齐到 16 的倍数。"""
    long_edge = max(w, h)
    if long_edge > max_edge:
        ratio = max_edge / long_edge
        w, h = w * ratio, h * ratio
    r16 = lambda v: max(16, int(round(v / 16)) * 16)  # noqa: E731
    return r16(w), r16(h)


def clamp_size(size: str | None) -> tuple[int, int]:
    """把平台传来的像素尺寸夹到本机承受范围，保证是 16 的倍数。"""
    if not size or size.strip().lower() in {"auto", ""}:
        return MAX_EDGE, MAX_EDGE
    raw = size.strip().lower().replace("×", "x")
    try:
        w_s, h_s = raw.split("x", 1)
        w, h = int(float(w_s)), int(float(h_s))
    except Exception:  # noqa: BLE001
        log.warning("看不懂的 size=%r，退回 %dx%d", size, MAX_EDGE, MAX_EDGE)
        return MAX_EDGE, MAX_EDGE
    if w <= 0 or h <= 0:
        return MAX_EDGE, MAX_EDGE

    long_edge = max(w, h)
    if long_edge > MAX_EDGE:
        scale = MAX_EDGE / long_edge
        w, h = w * scale, h * scale
        log.info("尺寸超上限，等比缩到 %dx%d", round(w), round(h))
    r16 = lambda v: max(16, int(round(v / 16)) * 16)  # noqa: E731
    return r16(w), r16(h)


def to_png_b64(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def mock_image(prompt: str, w: int, h: int):
    """占位图，用于不加载真模型时验证接线。"""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (w, h), (24, 24, 28))
    draw = ImageDraw.Draw(img)
    draw.rectangle([8, 8, w - 8, h - 8], outline=(90, 90, 110), width=2)
    draw.multiline_text((24, 24), f"MOCK\n{w}x{h}\n\n{prompt[:200]}", fill=(220, 220, 230), spacing=8)
    return img


def generate_one(
    prompt: str,
    w: int,
    h: int,
    steps: int,
    cfg: float,
    loras: tuple[str, ...],
    upscale_target: int = 0,
) -> str:
    if MOCK:
        return to_png_b64(mock_image(prompt, w, h))

    ensure_loras(loras)
    pipe = load_pipe()
    seed = int.from_bytes(os.urandom(4), "little") % (2**31)
    image = pipe(
        prompt=prompt,
        negative_prompt="",
        cfg_scale=cfg,
        height=h,
        width=w,
        seed=seed,
        num_inference_steps=steps,
        # 负向分支跳过第 22 层，省一半负向计算，官方默认值
        uncond_skip_layers=(22,),
        progress_bar_cmd=lambda x: x,
    )
    if upscale_target > 0:
        image = apply_upscale(image, upscale_target)
    return to_png_b64(image)


# ---------------------------------------------------------------- HTTP


app = FastAPI(title="MOSS-Image OpenAI-compatible API", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_auth(authorization: str | None) -> None:
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="API Key 不对")


class ImageGenRequest(BaseModel):
    # 平台会带 quality/background/style 等字段，MOSS 不认，直接忽略
    model_config = ConfigDict(extra="ignore")

    model: str = Field(default="moss-image-sft")
    prompt: str = Field(default="")
    n: int = Field(default=1, ge=1, le=10)
    size: str | None = None
    response_format: str | None = None


@app.get("/")
def root() -> dict[str, Any]:
    """根路径说明页，避免用户看到 404 以为服务没起来。"""
    return {
        "service": "MOSS-Image OpenAI 兼容服务",
        "status": "running",
        "说明": "这不是网页界面，是给 AIGC 创作台调用的 API。浏览器打开只会看到 JSON。",
        "可用接口": {
            "健康检查": "GET /health",
            "模型列表": "GET /v1/models",
            "文生图": "POST /v1/images/generations",
            "改图": "POST /v1/images/edits（不支持，返回 501）",
        },
        "接入方式": {
            "Base URL": "http://127.0.0.1:8188/v1",
            "模型列表接口": "/v1/models",
            "API Key": "随便填，例如 local",
        },
        "当前状态": {
            "mock": MOCK,
            "已加载模型": _pipe is not None,
            "长边上限": MAX_EDGE,
            "已配置加速LoRA": bool(TURBO_LORA),
            "已配置扩展LoRA": bool(NSFW_LORA),
            "加载错误": _load_error,
        },
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": _load_error is None,
        "mock": MOCK,
        "loaded": _pipe is not None,
        "max_edge": MAX_EDGE,
        "models": list(MODELS),
        "loras": sorted(_loaded_loras),
        "error": _load_error,
    }


@app.get("/v1/models")
def list_models(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    check_auth(authorization)
    now = int(time.time())
    base_labels = {
        "moss-image-sft": "原版 50步",
        "moss-image-sft-turbo": "加速 4步",
        "moss-image-sft-nsfw": "原版 50步+扩展",
        "moss-image-sft-turbo-nsfw": "加速 4步+扩展",
    }
    labels: dict[str, str] = {}
    for name in MODELS:
        base = name.removesuffix("-up")
        suffix = " · 后超分" if name.endswith("-up") else ""
        labels[name] = f"MOSS-Image {base_labels.get(base, base)}{suffix}（本地）"
    data = [
        {
            "id": name,
            "object": "model",
            "created": now,
            "owned_by": "local-moss",
            # 平台靠这个字段归类成"图片"，不用改它的名字匹配规则
            "type": "image",
            "display_name": labels.get(name, name),
        }
        for name in MODELS
    ]
    return {"object": "list", "data": data}


@app.post("/v1/images/generations")
def create_image(req: ImageGenRequest, authorization: str | None = Header(default=None)):
    check_auth(authorization)

    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    model = req.model if req.model in MODELS else next(iter(MODELS))
    if model != req.model:
        log.warning("未知模型 %r，退回 %r", req.model, model)
    steps, cfg, loras, use_up = MODELS[model]

    # -up 变体：size 是「目标输出尺寸」，基础图按 1/4 生成再超分补回来。
    # 普通变体：size 就是生成尺寸，超过上限才压。
    upscale_target = 0
    if use_up:
        target = parse_size(req.size) or (UPSCALE_TARGET, UPSCALE_TARGET)
        upscale_target = max(target)
        # 目标/4 作为基础图尺寸；但不能太小，否则基础图本身就没细节，
        # 超分只是在放大糊图。512 是实测的可用下限。
        base_w = max(target[0] // 4, MIN_GEN_EDGE)
        base_h = max(target[1] // 4, MIN_GEN_EDGE)
        w, h = fit_edge(base_w, base_h, MAX_EDGE)
    else:
        w, h = clamp_size(req.size)

    log.info(
        "生图开始 model=%s 生成=%dx%d 目标长边=%s n=%d steps=%d",
        model,
        w,
        h,
        upscale_target or "-",
        req.n,
        steps,
    )
    started = time.time()

    items: list[dict[str, str]] = []
    try:
        with GPU_LOCK:
            for _ in range(req.n):
                items.append(
                    {"b64_json": generate_one(req.prompt, w, h, steps, cfg, loras, upscale_target)}
                )
    except Exception as exc:  # noqa: BLE001
        log.exception("生图失败")
        return JSONResponse(
            status_code=500,
            content={"error": {"message": f"本地生图失败：{exc}", "type": "server_error"}},
        )

    log.info("生图完成 用时 %.1fs", time.time() - started)
    return {"created": int(started), "data": items}


@app.post("/v1/images/edits")
def edit_image():
    return JSONResponse(
        status_code=501,
        content={
            "error": {
                "message": "MOSS-Image 不支持改图：它没有图像条件输入，只能文生图。",
                "type": "not_implemented",
            }
        },
    )


class UpscaleRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # 传 base64 而不是 multipart：平台那边本来就习惯拿 b64，省一层编解码
    image: str = Field(description="原始图片的 base64")
    target_edge: int = Field(default=3840, description="目标长边像素")
    tile: int = Field(default=384, description="分块尺寸，显存紧张时调小")


@app.post("/v1/upscale")
def upscale_image(req: UpscaleRequest, authorization: str | None = Header(default=None)):
    """独立超分接口：给一张图，返回放大后的图。

    和生图完全解耦，不占 LoRA、不碰 MOSS 主模型，只加载 RRDBNet。
    """
    check_auth(authorization)

    if not UPSCALE_AVAILABLE:
        raise HTTPException(status_code=503, detail="超分模型未安装")

    try:
        raw = base64.b64decode(req.image, validate=True)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解析失败：{exc}") from exc

    target = max(16, int(req.target_edge))
    log.info("超分开始 输入=%dx%d 目标长边=%d", *img.size, target)

    try:
        with GPU_LOCK:
            import torch

            model, device = get_upscaler()
            if device.type == "cuda":
                torch.cuda.empty_cache()
            import sys

            sys.path.insert(0, MOSS_HOME)
            from upscale_torch import upscale_to

            started = time.time()
            out = upscale_to(img, model, device, target_edge=target, tile=max(64, int(req.tile)))
            log.info(
                "超分完成 %dx%d -> %dx%d 用时 %.1fs",
                *img.size,
                *out.size,
                time.time() - started,
            )
    except Exception as exc:  # noqa: BLE001
        log.exception("超分失败")
        return JSONResponse(
            status_code=500,
            content={"error": {"message": f"超分失败：{exc}", "type": "server_error"}},
        )

    return {
        "b64_json": to_png_b64(out),
        "width": out.size[0],
        "height": out.size[1],
        "source_width": img.size[0],
        "source_height": img.size[1],
    }


if __name__ == "__main__":
    log.info("启动于 http://127.0.0.1:%d/v1 （mock=%s, max_edge=%d）", PORT, MOCK, MAX_EDGE)
    log.info("可用模型: %s", list(MODELS))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
