"""
下载 MOSS-Image 量化权重到本仓库根目录下的 hf-cache/。

选的是 EntroPack 4.5bit 档：
    DiT         ~2.8GB   （原版 bf16 是 10.2GB）
    文本编码器   ~5.0GB   （原版 bf16 是 16.8GB）
    VAE + tokenizer  ~0.3GB
合计约 8GB，6GB 显存 + 16GB 内存能跑。

所有文件都落在 <仓库根>/hf-cache 里，用 HF_HOME 指过去，
DiffSynth 后面按 model_id 自动找到，不用再指定路径。
"""

import os
import sys

# 仓库根目录（本文件所在目录）
_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))

# 缓存目录默认放在仓库根目录的 hf-cache/，可用 HF_HOME 覆盖
# 必须在 import huggingface_hub 之前设置，否则它已经按默认路径初始化了
os.environ.setdefault("HF_HOME", os.path.join(_REPO_ROOT, "hf-cache"))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

from huggingface_hub import hf_hub_download, list_repo_files  # noqa: E402

QUANT_REPO = "DiffSynth-Studio/MOSS-Image-EntroPack"
# 注意：官方示例里写的是 openmoss/MOSS-Image-SFT，那是魔搭的命名；
# HF 上的仓库名是 OpenMOSS-Team/MOSS-Image-SFT，用错会 401。
BASE_REPO = "OpenMOSS-Team/MOSS-Image-SFT"

# 4.5bit = 均衡档。想更省显存改 dit_3.5bit，想更快改 dit_int8_6bit（3060 是 sm86，支持 INT8）
DIT = "models/MOSS-Image-SFT/dit_4.5bit.safetensors"
TE = "models/text_encoder_4.5bit.safetensors"


def human(n: int) -> str:
    return f"{n / 1024**3:.2f} GB"


def grab(repo: str, filename: str) -> str:
    path = hf_hub_download(repo_id=repo, filename=filename)
    print(f"  ✓ {filename}  ({human(os.path.getsize(path))})")
    return path


def main() -> int:
    print(f"缓存目录: {os.environ['HF_HOME']}")
    print(f"\n[1/3] 量化 DiT 与文本编码器 ({QUANT_REPO})")
    grab(QUANT_REPO, DIT)
    grab(QUANT_REPO, DIT.replace(".safetensors", ".json"))  # 量化配置 sidecar，必须一起下
    grab(QUANT_REPO, TE)
    grab(QUANT_REPO, TE.replace(".safetensors", ".json"))

    print(f"\n[2/3] VAE ({BASE_REPO})")
    grab(BASE_REPO, "vae/diffusion_pytorch_model.safetensors")

    print(f"\n[3/3] tokenizer ({BASE_REPO})")
    files = [f for f in list_repo_files(BASE_REPO) if f.startswith("tokenizer/")]
    for f in files:
        grab(BASE_REPO, f)

    print("\n全部下载完成。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已中断。重新运行会从断点续传。")
        sys.exit(130)
