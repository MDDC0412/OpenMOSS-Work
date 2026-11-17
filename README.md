# OpenMOSS-Work

> 在 6 GB 显存的笔记本上，把 5B 的 MOSS-Image 文生图模型跑成一套可自用的完整服务：
> **OpenAI 兼容接口 + 任务队列 + 4K 超分 + 配套 Web 创作台**。

一套可以直接 `git clone` 下来、按文档装好就能跑的本地 AIGC 生图工作站。核心是一个把
DiffSynth-Studio + MOSS-Image 包装成标准 OpenAI 协议的桥接服务，外加一个通用的大模型
Web 创作台——创作台不需要改一行代码，把它当普通供应商填进去即可。

---

## 目录

- [项目简介](#项目简介)
- [整体架构](#整体架构)
- [仓库结构](#仓库结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [接入创作台](#接入创作台)
- [模型与 LoRA](#模型与-lora)
- [超分](#超分)
- [任务队列](#任务队列)
- [API 参考](#api-参考)
- [硬件实测数据](#硬件实测数据)
- [环境配置踩坑记录](#环境配置踩坑记录)
- [故障排查](#故障排查)
- [已知限制](#已知限制)
- [安全与隐私](#安全与隐私)
- [许可证与致谢](#许可证与致谢)

---

## 项目简介

本仓库交付两样东西：

| 组件 | 技术栈 | 作用 |
| --- | --- | --- |
| **MOSS-Image 桥接服务**（`webui/`） | Python 3.12 · FastAPI · DiffSynth-Studio | 把只能跑在 Python 里的本地模型，包装成 OpenAI 兼容的 `/v1/images/generations` |
| **AIGC 创作台**（`AIGC-Creation-Platform/`） | Next.js 16 · React 19 · Ant Design 6 · TypeScript | 通用大模型 Web 客户端：对话 / 生图 / 超分 / 作品库 / 提示词包 |

配套两个独立脚本：

- `upscale_torch.py` —— Real-ESRGAN 分块超分推理（PyTorch + CUDA），显存恒定约 1.2 GB。
- `download_models.py` —— 一键拉取 4.5 bit 量化权重到本地缓存。

**为什么做成独立服务，而不是塞进 Next.js 路由**：模型要常驻内存（8 GB+）。Next.js 的请求
生命周期管不住显存，每条请求重新加载一次权重会慢到不可用。独立进程 + 协议对接才是正解，
而且创作台侧一行代码都不用改。

---

## 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器                                                       │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼──────────────────────────────────┐
│  AIGC 创作台 (Next.js, :3000)                                 │
│  AIGC-Creation-Platform/                                      │
│  生图 / 超分 / 作品库 / 对话 / 提示词包                          │
└───────────────────────────┬──────────────────────────────────┘
                            │ OpenAI 协议 + 自定义超分接口
┌───────────────────────────▼──────────────────────────────────┐
│  MOSS-Image 桥接服务 (FastAPI, :8188)                         │
│  webui/server.py                                              │
│  把 DiffSynth 包装成 OpenAI 兼容接口                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ Python API（常驻进程，模型只加载一次）
┌───────────────────────────▼──────────────────────────────────┐
│  DiffSynth-Studio + MOSS-Image 4.5bit 量化                    │
│  env/ (Python 3.12 虚拟环境)  models/ (8.25 GB 权重)          │
└──────────────────────────────────────────────────────────────┘
```

---

## 仓库结构

仓库只收录**源代码**。虚拟环境、模型权重、HuggingFace 缓存、`node_modules`、构建产物
全部由 `.gitignore` 排除，需要按[快速开始](#快速开始)自行生成。

```
OpenMOSS-Work/
├── README.md                       本文件：总览 + 部署 + 踩坑记录
├── .gitignore
├── env.example                     环境变量模板（只含占位符）
│
├── webui/                          MOSS-Image 桥接服务（FastAPI）
│   ├── server.py                   ★ 主程序：OpenAI 兼容层 + 队列 + 超分调度
│   ├── start_moss_api.cmd          ★ 一键启动（推荐入口，含平台）
│   ├── launcher.ps1                启动器：端口探测 + 就绪轮询 + 自动开浏览器
│   ├── run_moss_api.cmd            只起 MOSS 服务（不含平台）
│   ├── requirements.txt            Python 依赖
│   └── README.md                   桥接服务接入详解
│
├── AIGC-Creation-Platform/         Web 创作台（Next.js 源码）
│   ├── src/app/                    页面与 API 路由
│   │   ├── api/                    chat / images / models / providers /
│   │   │                           works / upscale / packs / settings …
│   │   ├── chat/  image/  works/  对话 / 生图 / 作品库
│   │   ├── providers/  packs/     供应商管理 / 提示词包
│   │   └── upscale/  video/       超分 / 视频（视频为二期占位）
│   ├── src/components/             UI 组件
│   ├── src/lib/                    核心逻辑（数据层、供应商、图片、作品）
│   ├── package.json
│   ├── next.config.ts              standalone 输出配置
│   └── README.md                   创作台自身说明
│
├── upscale_torch.py                ★ 超分核心（server.py 依赖，勿删）
├── download_models.py              权重下载脚本
├── start_all.cmd                   一键启动两个服务（cmd 入口）
├── start_all.ps1                   一键启动逻辑（PowerShell 7）
├── start_platform.cmd              单独启动创作台
│
└── ── 以下运行时目录不进仓库，首次运行前自行准备 ──
    ├── env/                        Python 3.12 虚拟环境
    ├── models/                     模型权重（约 8–10 GB）
    └── hf-cache/                   HuggingFace 下载缓存
```

> **⚠️ 不要删 `upscale_torch.py`**：`webui/server.py` 会把仓库根目录加入 `sys.path` 后
> `from upscale_torch import ...`。删掉它，超分功能直接报错。

---

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11（启动脚本为 `.cmd` + PowerShell） |
| GPU | NVIDIA，显存 ≥ 6 GB（4.5 bit 量化档）；8 GB 以上更从容 |
| 内存 | 16 GB 起；**虚拟内存需扩到 24 GB**（见[踩坑 2](#2-虚拟内存必须扩到-24-gb)） |
| 磁盘 | 约 15 GB（Python 环境 7 GB + 权重 10 GB） |
| Python | **3.12**（torch 无 3.13/3.14 轮子，不能用系统默认版本） |
| Node.js | **24+**（创作台使用内置 `node:sqlite`） |
| CUDA | 12.6 对应的 torch 轮子（见[踩坑 1](#1-torch-必须是-cu126不能用-pip-默认的)） |

---

## 快速开始

### 1. 准备 Python 环境

```powershell
# 在仓库根目录执行
python -m venv env
env\python.exe -m pip install --upgrade pip

# 先装 CUDA 版 torch，再从 PyPI 装其余依赖（顺序不能反，见踩坑 1）
env\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
env\python.exe -m pip install diffsynth "cupy-cuda12x[ctk]"
env\python.exe -m pip install -r webui\requirements.txt
env\python.exe -m pip install huggingface_hub
```

验证 GPU 可用：

```powershell
env\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# 期望输出类似：2.14.1+cu126 True
```

### 2. 下载模型权重

```powershell
env\python.exe download_models.py
```

脚本会把量化包下载到 `hf-cache/`，约 8 GB。中断可直接重跑，会断点续传。

### 3. 补齐 DiffSynth 期望的目录结构

`DIFFSYNTH_SKIP_DOWNLOAD=True` 时，DiffSynth 只在 `models/` 下找文件，**不会**去 HF 缓存找。
把下好的 VAE 与 tokenizer 放到：

```
models\OpenMOSS-Team\MOSS-Image-SFT\vae\diffusion_pytorch_model.safetensors
models\OpenMOSS-Team\MOSS-Image-SFT\tokenizer\{tokenizer.json, tokenizer_config.json, chat_template.jinja}
```

### 4. 准备超分权重（可选）

```powershell
# 从 Real-ESRGAN 官方仓库下载 RealESRGAN_x4plus.pth，放到：
models\upscale\RealESRGAN_x4plus.pth
```

没有该文件时，桥接服务会自动隐藏 `-up` 系列模型，其余功能不受影响。

### 5. 构建创作台

```powershell
cd AIGC-Creation-Platform
npm install
npm run build
cd ..
```

### 6. 启动

双击 **`webui\start_moss_api.cmd`**。启动器会：

1. 检测 8188 / 3000 端口，已在运行的就跳过；
2. 缺哪个起哪个（各自独立控制台窗口）；
3. 轮询等待就绪，实时打印进度点；
4. 汇总状态并自动打开浏览器。

看到下面的输出即为就绪：

```
  ------------------------------------------------------------
   MOSS API       OK    http://127.0.0.1:8188/v1
                        model_loaded=False   max_edge=960
   AIGC platform  OK    http://127.0.0.1:3000
  ------------------------------------------------------------
```

> `model_loaded=False` 是正常的 —— 模型懒加载，第一次生图时才读入显存（约 7–15 秒）。

**停止**：关掉对应的控制台窗口即停止对应服务。

### 只想验证接线（不下载权重）

在 `webui\run_moss_api.cmd` 里取消 `set MOSS_MOCK=1` 那一行的注释，服务会返回占位图
（图上写着 prompt 和尺寸），用来确认整条链路通不通。

---

## 配置说明

所有路径都以**仓库根目录**为基准自动推导，换盘、换目录名、`git clone` 到任意位置都不需要改代码。
需要自定义时用环境变量覆盖，见 `env.example`（该文件只含占位符，复制为本地配置后使用）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MOSS_HOME` | 仓库根目录 | 所有路径的基准目录 |
| `MOSS_PYTHON` | `%MOSS_HOME%\env\python.exe` | Python 解释器路径 |
| `MOSS_UPSCALE_DIR` | `%MOSS_HOME%\models\upscale` | 超分权重目录 |
| `MOSS_PORT` | `8188` | 监听端口 |
| `MOSS_MAX_EDGE` | `960` | 基础图长边上限（`-up` 模型的目标尺寸会 ÷4 后再受此限制） |
| `MOSS_MIN_GEN_EDGE` | `512` | `-up` 流程里基础图的最小长边 |
| `MOSS_UPSCALE` | 空 | `1` = 生成后自动超分 |
| `MOSS_UPSCALE_TARGET` | `3840` | 请求未指定 size 时的默认超分目标长边 |
| `MOSS_TURBO_LORA` | 空 | 4 步加速 LoRA 路径；配了才出现 `-turbo` 模型 |
| `MOSS_NSFW_LORA` | 空 | 额外风格 LoRA 路径；配了才出现对应模型变体 |
| `MOSS_MOCK` | 空 | `1` = 不加载模型，返回占位图 |
| `MOSS_API_KEY` | 空 | 配了就校验 `Authorization: Bearer` |
| `MOSS_DIT_PACKAGE` | `models/MOSS-Image-SFT/dit_4.5bit.safetensors` | DiT 量化包在仓库内的相对路径 |
| `MOSS_TE_PACKAGE` | `models/text_encoder_4.5bit.safetensors` | 文本编码器量化包相对路径 |
| `DIFFSYNTH_MODEL_BASE_PATH` | `%MOSS_HOME%\models` | **必须设**，否则 DiffSynth 会把权重下到当前目录 |
| `DIFFSYNTH_SKIP_DOWNLOAD` | `True` | 只用本地文件，不联网 |
| `HF_HOME` | `%MOSS_HOME%\hf-cache` | HuggingFace 缓存目录 |

---

## 接入创作台

**只需配置一次**（数据存在 `%APPDATA%\AIGC-Creation-Platform\` 里，不会丢）。

打开 `http://127.0.0.1:3000` → 左侧 **供应商** → 新增：

| 字段 | 填什么 |
| --- | --- |
| 名称 | `本地 MOSS-Image` |
| Base URL | `http://127.0.0.1:8188/v1` |
| 模型列表接口 | `/v1/models` |
| API Key | `local`（服务端不校验，除非设了 `MOSS_API_KEY`） |

点 **体检** → 应显示「连通正常，这把密钥能用 N 个模型」。

> 平台靠 `/v1/models` 返回的 `"type": "image"` 字段自动归类为图片模型，无需手工设置。

然后去 **生图** 页 → 供应商选「本地 MOSS-Image」→ 选一个模型 → 「加入队列」。

---

## 模型与 LoRA

服务端按环境变量动态生成模型列表，默认提供 4–8 个变体：

| 模型 ID | 步数 | 基础尺寸 | 后超分 | 用途 |
| --- | --- | --- | --- | --- |
| `moss-image-sft` | 50 | 960 | ✗ | 画质基准，文字最准 |
| `moss-image-sft-nsfw` | 50 | 960 | ✗ | 同上 + 扩展 LoRA |
| `moss-image-sft-turbo` | 4 | 960 | ✗ | 快速预览 |
| `moss-image-sft-turbo-nsfw` | 4 | 960 | ✗ | 快速 + 扩展 LoRA |
| `moss-image-sft-up` | 50 | 目标/4 | ✓ | 高画质 + 高分辨率 |
| `moss-image-sft-nsfw-up` | 50 | 目标/4 | ✓ | 高画质 + 扩展 + 高分辨率 |
| `moss-image-sft-turbo-up` | 4 | 目标/4 | ✓ | 快速 + 高分辨率 |
| `moss-image-sft-turbo-nsfw-up` | 4 | 目标/4 | ✓ | 全部特性 |

`-nsfw` 变体仅在设置 `MOSS_NSFW_LORA` 后出现；`-turbo` 变体仅在设置 `MOSS_TURBO_LORA` 后出现；
`-up` 变体仅在超分权重存在时出现。

### `-up` 后缀的语义

带 `-up` 的模型把请求里的 `size` 当作**目标输出尺寸**：

```
请求 size=3840x2160
  → 基础图按 3840/4 = 960 生成
  → 超分 4 倍
  → 缩放到 3840x2160 返回
```

基础图有 512 的下限（`MOSS_MIN_GEN_EDGE`），低于这个尺寸超分只是在放大一张糊图。

### LoRA 说明

| LoRA | 作用 | 副作用 |
| --- | --- | --- |
| `moss_image_sft_4step_v2.0` | 50 步 → 4 步蒸馏 | 细节损失，**小字会糊** |
| `pytorch_lora_weights` | 扩展风格范围 | 普通图的稳定性可能下降 |

**要画质就用不带 LoRA 的 50 步版本。** 两者叠加时，加速 LoRA 的加速效果保留。

---

## 超分

### 为什么用 PyTorch 而不是 ONNX

实测对比（同一张 768×576 图放大到 3840）：

| 方案 | 耗时 | 结论 |
| --- | --- | --- |
| ONNX + CPU | 203 秒 | ❌ |
| ONNX + DirectML | 199–278 秒 | ❌ **比 CPU 还慢** |
| **PyTorch + CUDA** | **2.3 秒** | ✅ 快 88 倍 |

原因：RRDBNet 由 23 个残差块 × 5 层小卷积组成，全是小算子。ONNX Runtime 逐算子 dispatch，
调度开销吃光了计算收益；PyTorch 的卷积融合和显存规划好得多。

### 独立使用

```powershell
# 自动输出 原文件名_x4.png
env\python.exe upscale_torch.py "图片.png"

# 指定输出 + 缩到 4K 长边
env\python.exe upscale_torch.py "输入.png" "输出.png" --max-edge 3840

# 显存紧张时手动指定分块尺寸
env\python.exe upscale_torch.py "输入.png" "输出.png" --tile 256

# 强制整图模式（小图更快，大图会吃满显存）
env\python.exe upscale_torch.py "输入.png" "输出.png" --whole
```

### 在平台里用

两种入口：

1. **侧边栏「超分」页** → 上传图片或从作品库选 → 选目标分辨率（最高 4K）→ 加入队列；
2. **作品库** → 鼠标悬停任意图 → 右上角超分图标 → 自动带入该图。

结果自动存进作品库。

### 超分的能力边界

| 能做 | 做不到 |
| --- | --- |
| 放大到 3072 / 3840 / 8192 | ❌ 让糊掉的小字变清楚 |
| 让线条、纹理、边缘更锐利 | ❌ 修正图里写错的字 |
| 打印 / 壁纸级尺寸输出 | ❌ 补出原本不存在的细节 |

**超分是放大器，不是重画。** 要小字清楚，只能靠原生高分辨率生成。

---

## 任务队列

生图、改图、超分**共用一个队列**，严格串行（并发恒为 1）。

### 为什么并发只能是 1

服务端有 `GPU_LOCK`，物理上只有一块 GPU。如果前端并发 2 个请求：

```
任务 A → 服务端计算 178 秒
任务 B → 服务端排队等待（178 秒后才开始）
```

任务 B 的 HTTP 请求在等待期间一直挂着，**178 × 2 = 356 秒撞上客户端超时** → B 必然失败。

所以队列的价值是**批处理**（一次丢 N 张进去不用守着），而不是并行加速。

### 界面

- **侧边栏底部「任务队列」**：显示「运行中」标记 + 待处理数量角标；
- 点开是右侧抽屉：每条任务的状态、类型、说明、耗时、产出张数；
- 可单独取消排队中的任务，或停止正在跑的那一个。

### 行为说明

| 场景 | 行为 |
| --- | --- |
| 任务运行中继续改表单 | ✅ 允许，控件不再禁用 |
| 任务运行中继续入队 | ✅ 允许，按顺序执行 |
| 切到别的页面 | ✅ 队列继续跑（状态在 AppProviders 的 Provider 里，不随页面卸载） |
| 刷新页面 / 关浏览器 | ⚠️ 队列清空（已完成的作品已落盘，不会丢） |
| 某条任务失败 | ✅ 只影响这一条，后面的继续 |

---

## API 参考

除了标准 OpenAI 接口，额外提供一个超分接口。

### 标准 OpenAI 兼容

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 服务说明（浏览器直接打开看） |
| GET | `/health` | 健康检查：`ok`、`loaded`、`max_edge`、`models`、`loras` |
| GET | `/v1/models` | 模型列表，每个带 `"type": "image"` |
| POST | `/v1/images/generations` | 文生图，返回 `{data:[{b64_json}]}` |
| POST | `/v1/images/edits` | 返回 501（MOSS-Image 没有图像条件输入） |

### 自定义超分接口

**`POST /v1/upscale`**

```json
// 请求
{
  "image": "<base64>",
  "target_edge": 3840,
  "tile": 384
}

// 响应
{
  "b64_json": "<base64>",
  "width": 3840,
  "height": 2880,
  "source_width": 768,
  "source_height": 576
}
```

### 调用示例

```powershell
# 文生图
$body = @{
  model  = "moss-image-sft-turbo-up"
  prompt = "一只橘猫坐在窗台上，阳光斜照，写实摄影"
  n      = 1
  size   = "2048x2048"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8188/v1/images/generations" `
  -Method Post -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer local" } -Body $body
```

```bash
# curl 版本
curl -s http://127.0.0.1:8188/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local" \
  -d '{"model":"moss-image-sft-turbo","prompt":"a cat on a windowsill","n":1}'
```

---

## 硬件实测数据

**测试环境**：RTX 3060 Laptop 6 GB / 16 GB DDR5 4800 / Windows 11

### 生图（MOSS-Image 4.5bit 量化）

| 模型 | 分辨率 | 步数 | 耗时 | 显存占用 |
| --- | --- | --- | --- | --- |
| `moss-image-sft-turbo` | 512² | 4 | 33 秒 | 1.4 GB |
| `moss-image-sft-turbo` | 768² | 4 | 17 秒 | 1.4 GB |
| `moss-image-sft-turbo` | 1024² | 4 | 30 秒 | 1.6 GB |
| `moss-image-sft-turbo` | 960² | 4 | 47 秒 | 1.4 GB |
| `moss-image-sft` | 768² | 50 | 178 秒 | 1.4 GB |
| `moss-image-sft` | 960² | 50 | 278 秒 | 1.4 GB |

> 4 步是蒸馏 LoRA 加速版，50 步是原版。**4 步的文字渲染会明显劣化**，要写字请用 50 步。

### 超分（RealESRGAN x4plus，分块模式）

| 输入 | 输出 | 耗时 | 显存峰值 |
| --- | --- | --- | --- |
| 768×576 | 3072×2304 | 2.3 秒 | 3.62 GB |
| 1024×1024 | 4096×4096 | 16.5 秒 | 8.54 GB ⚠️ 超物理显存 |
| 1536×1536 | 6144×6144 | 16.4 秒 | **1.23 GB** |
| 2048×2048 | 8192×8192 | 23.6 秒 | **1.23 GB** |
| 768×576 | 3840×2880（4K） | **10.9 秒** | 1.23 GB |

> **分块模式显存恒定 1.23 GB**，不受输入尺寸影响。整图模式在 1024² 以上会溢出到共享内存，反而更慢。

### 完整链路

| 流程 | 耗时 |
| --- | --- |
| 960² 生成（4 步）+ 超分到 4K | **67 秒** |
| 512² 生成（4 步）+ 超分到 2K | 42 秒 |
| 加载模型（首次，只一次） | 7–15 秒 |

---

## 环境配置踩坑记录

这些是实际踩过的坑，重装时按这个顺序可以少走弯路。

### 1. torch 必须是 cu126，不能用 pip 默认的

`pip install diffsynth` 会从 PyPI 拉 **torch 2.15.0+cpu**，覆盖掉 CUDA 版。

```powershell
# 正确顺序：先装 torch，再从 PyPI 装其他
env\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
env\python.exe -m pip install diffsynth fastapi uvicorn pillow huggingface_hub
```

验证：`env\python.exe -c "import torch; print(torch.cuda.is_available())"` 必须是 `True`。

> cu124 的 index 最高只有 torch 2.6.0，配不上 diffsynth 2.2.2；cu126 上 2.14.1 可用。

### 2. 虚拟内存必须扩到 24 GB

`os error 1455（页面文件太小）` 的根因：DiT 反量化成 bf16 后约 10 GB 常驻 CPU 内存，
加上编码器 5.56 GB 映射，超过 16 GB 物理内存。

```
系统属性 → 高级 → 性能设置 → 高级 → 虚拟内存 → 更改
→ 取消「自动管理」→ 选一个空间充足的盘 → 自定义大小 24576 / 24576 → 设置 → 重启
```

改完提交上限应从 30.7 GB 涨到 ~54.7 GB。**必须重启生效。**

### 3. VAE 和 tokenizer 要手动放到 DiffSynth 期望的路径

`DIFFSYNTH_SKIP_DOWNLOAD=True` 时 DiffSynth 只在 `DIFFSYNTH_MODEL_BASE_PATH` 下找文件，
不会去 HF 缓存找。

```
models\OpenMOSS-Team\MOSS-Image-SFT\vae\diffusion_pytorch_model.safetensors
models\OpenMOSS-Team\MOSS-Image-SFT\tokenizer\{tokenizer.json, tokenizer_config.json, chat_template.jinja}
```

### 4. HF 仓库名带 Team 前缀

`openmoss/MOSS-Image-SFT` 是**魔搭**的命名，HF 上叫 `OpenMOSS-Team/MOSS-Image-SFT`。用错会 401。

### 5. **最关键的一个**：必须显式传 offload 配置

如果不给 `ModelConfig` 传 vram 配置，DiffSynth 默认把权重尽量塞进 GPU，6 GB 卡塞满后
每步都要来回换入换出：

| 配置 | 512² 4 步耗时 | 显存 |
| --- | --- | --- |
| 不传（默认） | 182.7 秒 | 5.87 GB |
| **传 offload 配置** | **32.9 秒** | **1.37 GB** |

```python
vram = {
    "offload_dtype": torch.bfloat16, "offload_device": "cpu",
    "onload_dtype": torch.bfloat16,  "onload_device": "cpu",
    "preparing_dtype": torch.bfloat16, "preparing_device": "cuda",
    "computation_dtype": torch.bfloat16, "computation_device": "cuda",
}
```

**慢 5.5 倍、多占 4.5 GB 显存**，全是因为漏了这一个参数。

### 6. EntroPack 量化包要连同 .json sidecar 一起注册

量化包不是普通权重，必须读 `.json` 配置并注册进 `MODEL_CONFIGS`，否则 DiffSynth
不知道怎么反量化。

### 7. cupy-cuda12x 需要 CUDA 头文件

EntroPack 的熵解码在 GPU 上跑，依赖 CuPy：

```powershell
pip install "cupy-cuda12x[ctk]"
```

只装 `cupy-cuda12x` 会报 `Failed to find CUDA headers`。

### 8. 不要用 FP8 offload

`offload_dtype=torch.float8_e4m3fn` 会让进程直接崩（`0xC0000005`）—— CPU 不支持 fp8 反量化运算。

### 9. Next.js standalone 部署要单独复制 static

`output: "standalone"` **不会**把 `.next/static` 打进 standalone 目录。只复制 standalone
会导致页面 chunk 404、白屏卡加载。

```powershell
robocopy ".next\standalone" $dst /E
robocopy ".next\static" "$dst\.next\static" /E    # ← 这一步不能漏
```

### 10. cmd 批处理不能带 UTF-8 中文

cmd.exe 按 GBK 解析 `.cmd` 文件，UTF-8 中文注释会被当成命令执行，报一堆
`'xxx' is not recognized`。

**所有 `.cmd` 一律写纯 ASCII。** PowerShell 脚本（`.ps1`）用 `powershell.exe` 跑时同理。

### 11. `set VAR=value && next` 会把空格吃进变量

```cmd
set HOSTNAME=127.0.0.1 && node server.js
```

`HOSTNAME` 会变成 `"127.0.0.1 "`（带尾随空格），Node 报 `ENOTFOUND`。

正确写法：

```cmd
set "HOSTNAME=127.0.0.1" && node server.js
```

---

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `os error 1455` | 虚拟内存不足 | 扩到 24 GB 并重启（见踩坑 2） |
| `Cannot detect the model type. File: []` | VAE/tokenizer 路径不对 | 按踩坑 3 放文件 |
| `DispatchError: No backend can handle 'lattice_rans'` | 缺 cupy | 装 `cupy-cuda12x[ctk]` |
| 进程 `0xC0000005` 崩溃 | 用了 fp8 offload | 改回 bf16 |
| 生图慢 5 倍 | 漏了 offload 配置 | 见踩坑 5 |
| 页面白屏 / chunk 404 | 没复制 `.next/static` | 见踩坑 9 |
| `.cmd` 报一堆英文命令错误 | UTF-8 中文注释 | 见踩坑 10 |
| `start_moss_api.cmd` 报 `pwsh not found` | 系统只有 PowerShell 5.1 | 已修复，入口改用 `powershell.exe` |
| 平台 3000 起不来 `ENOTFOUND 127.0.0.1` | `set` 吃了空格 | 见踩坑 11 |
| 健康检查通过但生图 500 | 模型加载失败 | 看 8188 窗口的 traceback |
| `torch.cuda.is_available()` 为 False | 装成了 CPU 版 torch | 见踩坑 1 |
| 超分不生效、`-up` 模型不出现 | 缺 `RealESRGAN_x4plus.pth` | 放到 `models\upscale\` |

### 快速自检

```powershell
# 服务是否活着
Invoke-RestMethod http://127.0.0.1:8188/health

# CUDA 是否可用
env\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"

# 显存占用
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

# 端口占用
Get-NetTCPConnection -LocalPort 8188,3000 -State Listen
```

---

## 已知限制

| 限制 | 说明 |
| --- | --- |
| **不支持改图** | MOSS-Image 架构上没有图像编码器，只有文本通路。`/v1/images/edits` 返回 501 |
| **不修正文字错误** | 超分只加像素不加信息，糊的字放大还是糊的 |
| **2048² 以上走共享内存** | 整图模式会溢出到页面文件，反而更慢；用分块模式 |
| **队列不持久化** | 刷新页面队列清空（已完成作品不受影响） |
| **并发恒为 1** | 单卡物理限制，见[任务队列](#任务队列) |
| **4.5bit 量化有精度损失** | bf16 原版权重 27 GB，6 GB 卡装不下 |
| **小字需要布局控制** | 不用 JSON Layout 的话，未指定的文字区域模型会自己编 |
| **仅 Windows** | 启动脚本为 `.cmd` + PowerShell；核心服务本身跨平台，可自行改写 |

---

## 安全与隐私

本仓库**不包含任何密钥、令牌、账号或本机路径**，可安全公开或私有托管。

- **API Key 一律通过环境变量注入**（`MOSS_API_KEY`、`MOSS_TURBO_LORA` 等），不写进代码。
  `.env` 已被 `.gitignore` 排除，只提交 `.env.example` 模板。
- **所有路径基于仓库根目录推导**，不含 `C:\Users\<用户名>` 之类的绝对路径。
- **创作台的用户数据全部存放在项目目录之外**（`%APPDATA%\AIGC-Creation-Platform\`），
  包含 SQLite 数据库、生成的图片、上传的原图，不会被误提交。
- 提交前建议自查：

  ```powershell
  git grep -nIiE "sk-[a-z0-9]{16}|ghp_|hf_[a-z0-9]{20}|api[_-]?key\s*[:=]"
  ```

---

## 许可证与致谢

| 组件 | 许可证 |
| --- | --- |
| MOSS-Image 权重与代码 | Apache-2.0 |
| DiffSynth-Studio | Apache-2.0 |
| RealESRGAN_x4plus | BSD-3-Clause |
| 4x-UltraSharp | CC-BY-4.0 |
| 4 步蒸馏 LoRA | Apache-2.0 |
| 本项目自有代码 | 见 `LICENSE` |

**本项目仅用于个人本地研究与创作。** 生成内容需自行承担合规责任 —— 本地部署没有服务端
审核层，但训练数据过滤、法律法规要求依然存在。

### 相关链接

- [MOSS-Image 技术报告](https://arxiv.org/abs/2610.23374)
- [MOSS-Image GitHub](https://github.com/OpenMOSS/MOSS-Image)
- [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio)
- [EntroPack 量化包](https://huggingface.co/DiffSynth-Studio/MOSS-Image-EntroPack)
- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)

---

*最后更新：2026-11-17*
