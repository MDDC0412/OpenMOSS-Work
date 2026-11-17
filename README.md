# OpenMOSS-Work

MOSS-Image 本地推理服务与配套 Web 创作台。

- `webui/` —— 基于 FastAPI 的 OpenAI 兼容桥接服务，把 DiffSynth-Studio + MOSS-Image 包装成
  `/v1/images/generations` 接口。
- `AIGC-Creation-Platform/` —— 基于 Next.js 16 的创作台，通过 OpenAI 协议接入上述服务。

---

## 目录

- [功能](#功能)
- [系统架构](#系统架构)
- [仓库结构](#仓库结构)
- [环境要求](#环境要求)
- [安装](#安装)
- [运行](#运行)
- [配置项](#配置项)
- [接入创作台](#接入创作台)
- [模型变体](#模型变体)
- [超分](#超分)
- [任务队列](#任务队列)
- [API 参考](#api-参考)
- [性能数据](#性能数据)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [许可证](#许可证)
- [致谢](#致谢)

---

## 功能

**推理服务（`webui/`）**

- OpenAI 兼容接口：`GET /v1/models`、`POST /v1/images/generations`
- 4.5 bit 量化权重，6 GB 显存可运行
- 层级别 CPU offload，显存占用恒定约 1.4 GB
- LoRA 动态挂载：4 步蒸馏加速、扩展风格
- 模型变体由环境变量与权重存在性动态生成
- `-up` 变体：先生成低分辨率基础图，再 4× 超分到目标尺寸
- GPU 互斥锁，串行执行，避免显存竞争

**创作台（`AIGC-Creation-Platform/`）**

- 供应商管理：Base URL + API Key + 模型列表接口，一键连通性体检
- 对话：流式输出，会话持久化
- 生图：文生图、改图、一次多张；参数化表单与只读原始请求面板
- 超分：独立页面，或从作品库直接发起
- 作品库：本地存档、参数回看、系统资源管理器定位
- 提示词包：外链或本地文件导入，跨模态共用
- 数据目录可迁移，存放在项目外

---

## 系统架构

```
浏览器
  │ HTTP
  ▼
AIGC 创作台 (Next.js, :3000)          AIGC-Creation-Platform/
  │ OpenAI 协议 + 自定义超分接口
  ▼
MOSS-Image 桥接服务 (FastAPI, :8188)  webui/server.py
  │ Python API
  ▼
DiffSynth-Studio + MOSS-Image         env/(Python 3.12) + models/(量化权重)
```

推理服务是常驻进程，模型加载后驻留显存，跨请求复用。创作台不参与模型加载，
仅通过 HTTP 协议调用。

---

## 仓库结构

```
OpenMOSS-Work/
├── README.md                     本文件
├── LICENSE
├── .gitignore
├── env.example                   环境变量模板（占位符，无真实值）
│
├── webui/                        推理服务
│   ├── server.py                 主程序：OpenAI 兼容层、队列、超分调度
│   ├── requirements.txt          Python 依赖
│   ├── start_moss_api.cmd        启动入口：同时拉起服务与创作台
│   ├── launcher.ps1              启动逻辑：端口探测、就绪轮询、打开浏览器
│   ├── run_moss_api.cmd          仅启动推理服务
│   └── README.md                 接入细节
│
├── AIGC-Creation-Platform/       创作台源码
│   ├── src/app/                  页面与 API 路由
│   ├── src/components/           UI 组件
│   ├── src/lib/                  数据层、供应商、图片、作品逻辑
│   ├── package.json
│   └── next.config.ts            standalone 输出
│
├── upscale_torch.py              Real-ESRGAN 分块超分（server.py 依赖）
├── download_models.py            量化权重下载
├── start_all.cmd                 同时启动两个服务
├── start_all.ps1                 上述脚本的实现
└── start_platform.cmd            仅启动创作台
```

以下目录不在版本库中，需按[安装](#安装)生成：

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `env/` | Python 3.12 虚拟环境 | 约 7 GB |
| `models/` | 模型权重 | 约 10 GB |
| `hf-cache/` | HuggingFace 下载缓存 | 约 8.7 GB |

`upscale_torch.py` 必须在根目录：`server.py` 会把仓库根目录加入 `sys.path` 后
`from upscale_torch import ...`。

---

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11（启动脚本为 `.cmd` + PowerShell） |
| GPU | NVIDIA，显存 ≥ 6 GB |
| 内存 | 16 GB，虚拟内存需扩至 24 GB（见[常见问题](#os-error-1455)） |
| 磁盘 | ≥ 25 GB |
| Python | 3.12（torch 无 3.13+ 轮子） |
| Node.js | 24+（创作台使用内置 `node:sqlite`） |
| CUDA | 12.6 对应的 torch 构建（`cu126`） |

---

## 安装

所有命令在仓库根目录执行。

### 1. Python 环境

```powershell
python -m venv env
env\python.exe -m pip install --upgrade pip

# torch 必须先装 CUDA 版，否则会被 diffsynth 依赖的 CPU 版覆盖
env\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
env\python.exe -m pip install diffsynth "cupy-cuda12x[ctk]"
env\python.exe -m pip install -r webui\requirements.txt
env\python.exe -m pip install huggingface_hub
```

验证：

```powershell
env\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# 2.14.1+cu126 True
```

### 2. 模型权重

```powershell
env\python.exe download_models.py
```

下载 EntroPack 4.5 bit 量化包（DiT 2.7 GB + 文本编码器 5.6 GB + VAE、tokenizer）到
`hf-cache/`，约 8 GB。中断后重跑会断点续传。

### 3. 目录结构补齐

`DIFFSYNTH_SKIP_DOWNLOAD=True` 时 DiffSynth 只在 `DIFFSYNTH_MODEL_BASE_PATH` 下查找文件，
不会读 HF 缓存。需将 VAE 与 tokenizer 放到：

```
models\OpenMOSS-Team\MOSS-Image-SFT\vae\diffusion_pytorch_model.safetensors
models\OpenMOSS-Team\MOSS-Image-SFT\tokenizer\tokenizer.json
models\OpenMOSS-Team\MOSS-Image-SFT\tokenizer\tokenizer_config.json
models\OpenMOSS-Team\MOSS-Image-SFT\tokenizer\chat_template.jinja
```

### 4. 超分权重（可选）

从 [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) 获取 `RealESRGAN_x4plus.pth`，放入：

```
models\upscale\RealESRGAN_x4plus.pth
```

缺失时 `-up` 系列模型不会出现在 `/v1/models`，其余功能不受影响。

### 5. 创作台

```powershell
cd AIGC-Creation-Platform
npm install
npm run build
cd ..
```

### 6. 可选：加速 LoRA

4 步蒸馏 LoRA 可将 50 步降到 4 步。下载后设置环境变量 `MOSS_TURBO_LORA` 指向文件，
`-turbo` 变体即出现在模型列表中。

---

## 运行

双击 `webui\start_moss_api.cmd`。启动器行为：

1. 检测 8188 与 3000 端口，已在监听则跳过；
2. 分别拉起缺失的服务，各自独立控制台窗口；
3. 轮询 `/health` 与首页，打印进度；
4. 输出状态汇总并打开浏览器。

正常输出：

```
  ------------------------------------------------------------
   MOSS API       OK    http://127.0.0.1:8188/v1
                        model_loaded=False   max_edge=960
   AIGC platform  OK    http://127.0.0.1:3000
  ------------------------------------------------------------
```

`model_loaded=False` 表示模型尚未加载。推理服务采用懒加载，首次生图时载入，
耗时 7–15 秒，之后常驻。

停止服务：关闭对应的控制台窗口。

**只验证链路不加载模型**：在 `webui\run_moss_api.cmd` 中取消 `set MOSS_MOCK=1` 的注释，
服务返回占位图，图上标注 prompt 与尺寸。

---

## 配置项

路径默认基于仓库根目录推导，移动到其他磁盘或目录无需修改代码。覆盖方式见 `env.example`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MOSS_HOME` | 仓库根目录 | 所有路径的基准 |
| `MOSS_PYTHON` | `%MOSS_HOME%\env\python.exe` | Python 解释器 |
| `MOSS_UPSCALE_DIR` | `%MOSS_HOME%\models\upscale` | 超分权重目录 |
| `MOSS_PORT` | `8188` | 监听端口 |
| `MOSS_MAX_EDGE` | `768`（`run_moss_api.cmd` 设为 `960`） | 基础图长边上限 |
| `MOSS_MIN_GEN_EDGE` | `512` | `-up` 流程中基础图的最小长边 |
| `MOSS_UPSCALE` | 空 | `1` = 生成后自动超分 |
| `MOSS_UPSCALE_TARGET` | `3840` | 默认超分目标长边 |
| `MOSS_TURBO_LORA` | 空 | 4 步加速 LoRA 路径 |
| `MOSS_NSFW_LORA` | 空 | 扩展风格 LoRA 路径 |
| `MOSS_MOCK` | 空 | `1` = 不加载模型，返回占位图 |
| `MOSS_API_KEY` | 空 | 设置后校验 `Authorization: Bearer` |
| `MOSS_DIT_PACKAGE` | `models/MOSS-Image-SFT/dit_4.5bit.safetensors` | DiT 量化包相对路径 |
| `MOSS_TE_PACKAGE` | `models/text_encoder_4.5bit.safetensors` | 文本编码器相对路径 |
| `DIFFSYNTH_MODEL_BASE_PATH` | `%MOSS_HOME%\models` | DiffSynth 权重根目录 |
| `DIFFSYNTH_SKIP_DOWNLOAD` | `True` | 仅用本地文件 |
| `HF_HOME` | `%MOSS_HOME%\hf-cache` | HuggingFace 缓存目录 |

环境变量通过 `set "NAME=value"` 形式在 `.cmd` 中设置，或作为系统环境变量传入。
`MOSS_API_KEY` 为空时服务不校验鉴权，仅应在 `127.0.0.1` 监听时使用。

---

## 接入创作台

打开 `http://127.0.0.1:3000` → 左侧「供应商」→ 新增：

| 字段 | 值 |
| --- | --- |
| 名称 | `本地 MOSS-Image` |
| Base URL | `http://127.0.0.1:8188/v1` |
| 模型列表接口 | `/v1/models` |
| API Key | `local`（服务端未设 `MOSS_API_KEY` 时任意值均可） |

点击「体检」，应返回「连通正常，这把密钥能用 N 个模型」。创作台依据 `/v1/models`
返回的 `"type": "image"` 自动归类为图片模型。

之后在「生图」页选择该供应商与模型即可。

创作台数据存放在项目目录之外：

```
%APPDATA%\AIGC-Creation-Platform\
├── platform.db      SQLite：供应商、模型、会话、作品、提示词包、偏好
├── works\           生成的图片
├── uploads\         改图上传的原图
└── data-dir.json    数据目录指针（仅改过目录时存在）
```

左侧导航底部显示当前数据目录，可迁移至其他位置。迁移目标须为空文件夹，新旧目录不可
互相嵌套，失败自动回滚。

---

## 模型变体

模型列表由环境变量与权重存在性动态生成：

| 模型 ID | 步数 | 基础尺寸 | 后超分 | 出现条件 |
| --- | --- | --- | --- | --- |
| `moss-image-sft` | 50 | 960 | ✗ | 始终 |
| `moss-image-sft-nsfw` | 50 | 960 | ✗ | 设置 `MOSS_NSFW_LORA` |
| `moss-image-sft-turbo` | 4 | 960 | ✗ | 设置 `MOSS_TURBO_LORA` |
| `moss-image-sft-turbo-nsfw` | 4 | 960 | ✗ | 上述两者均设置 |
| `moss-image-sft-up` | 50 | 目标/4 | ✓ | 存在超分权重 |
| `moss-image-sft-nsfw-up` | 50 | 目标/4 | ✓ | 超分权重 + `MOSS_NSFW_LORA` |
| `moss-image-sft-turbo-up` | 4 | 目标/4 | ✓ | 超分权重 + `MOSS_TURBO_LORA` |
| `moss-image-sft-turbo-nsfw-up` | 4 | 目标/4 | ✓ | 全部条件 |

`-up` 变体把请求中的 `size` 视为目标输出尺寸：

```
size=3840x2160
  → 基础图按 3840/4 = 960 生成（受 MOSS_MIN_GEN_EDGE=512 下限与 MOSS_MAX_EDGE 上限约束）
  → 4× 超分
  → 缩放至 3840x2160
```

LoRA 取舍：

| LoRA | 作用 | 副作用 |
| --- | --- | --- |
| `moss_image_sft_4step_v2.0` | 50 步蒸馏至 4 步 | 细节损失，小字明显劣化 |
| `pytorch_lora_weights` | 扩展风格范围 | 普通图稳定性下降 |

需要最高画质时使用不带 LoRA 的 50 步变体。两个 LoRA 叠加时，加速效果保留。

---

## 超分

`upscale_torch.py` 实现 RRDBNet（Real-ESRGAN / UltraSharp 通用结构）推理。

选择 PyTorch 而非 ONNX 的原因：RRDBNet 由 23 个残差块 × 5 层小卷积组成，ONNX Runtime
逐算子调度开销超过计算本身，实测比 CPU 更慢。

| 方案 | 耗时（768×576 → 3840） |
| --- | --- |
| ONNX + CPU | 203 秒 |
| ONNX + DirectML | 199–278 秒 |
| PyTorch + CUDA | 2.3 秒 |

分块模式显存恒定 1.23 GB，与输入尺寸无关。整图模式在 1024² 以上会溢出至共享内存。

### 命令行用法

```powershell
# 默认输出 <原名>_x4.png
env\python.exe upscale_torch.py "图片.png"

# 指定输出并缩放至目标长边
env\python.exe upscale_torch.py "输入.png" "输出.png" --max-edge 3840

# 显存不足时缩小分块
env\python.exe upscale_torch.py "输入.png" "输出.png" --tile 256

# 强制整图模式（小图更快，大图会占满显存）
env\python.exe upscale_torch.py "输入.png" "输出.png" --whole

# 指定权重文件
env\python.exe upscale_torch.py "输入.png" --weights path\to\model.pth
```

### 平台内用法

- 「超分」页：上传图片或从作品库选择，指定目标分辨率（最高 4K），加入队列；
- 作品库：悬停作品卡，点击超分图标，自动带入该图。

结果自动写入作品库。

超分只增加像素，不增加信息：放大无法恢复模糊的文字，也无法补出原本不存在的细节。

---

## 任务队列

生图、改图、超分共用一个队列，串行执行。

**并发恒为 1 的原因**：服务端持有 `GPU_LOCK`，物理上只有一块 GPU。并发请求中后一个会在
服务端排队，其 HTTP 连接持续挂起，最终超时失败。队列的用途是批量提交，而非并行加速。

队列位于内存，刷新页面即清空。已完成的作品已落盘，不受影响。

| 场景 | 行为 |
| --- | --- |
| 任务运行时修改表单 | 允许 |
| 任务运行时继续入队 | 允许，按序执行 |
| 切换页面 | 队列继续运行 |
| 刷新页面 / 关闭浏览器 | 队列清空 |
| 单条任务失败 | 仅影响该条 |

侧边栏底部显示运行状态与待处理数量，点开为任务抽屉，可取消排队任务或停止当前任务。

---

## API 参考

默认监听 `http://127.0.0.1:8188`。设置 `MOSS_API_KEY` 后，除 `/` 与 `/health` 外的接口
均需携带 `Authorization: Bearer <key>`。

### `GET /`

服务信息与当前状态，JSON 格式。

### `GET /health`

健康检查，无需鉴权。

```json
{
  "ok": true,
  "mock": false,
  "loaded": false,
  "max_edge": 960,
  "models": ["moss-image-sft", "moss-image-sft-turbo"],
  "loras": [],
  "error": null
}
```

`ok` 表示加载过程未出错；`loaded` 表示模型是否已驻留显存。

### `GET /v1/models`

OpenAI 模型列表格式，附 `type` 与 `display_name`。

```json
{
  "object": "list",
  "data": [
    {
      "id": "moss-image-sft",
      "object": "model",
      "created": 1760000000,
      "owned_by": "local-moss",
      "type": "image",
      "display_name": "MOSS-Image 原版 50步（本地）"
    }
  ]
}
```

### `POST /v1/images/generations`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `model` | string | `moss-image-sft` | 未知模型回退至列表首项 |
| `prompt` | string | — | 必填，不能为空 |
| `n` | int | `1` | 1–10，服务端串行执行 |
| `size` | string | — | `WxH`，等比缩至 `MOSS_MAX_EDGE` 并对齐 16 的倍数 |
| `response_format` | string | — | 保留字段 |

其余字段（`quality`、`background`、`style` 等）被忽略，不报错。

响应：

```json
{
  "created": 1760000000,
  "data": [{ "b64_json": "<base64 PNG>" }]
}
```

### `POST /v1/images/edits`

固定返回 501。MOSS-Image 无图像编码器，不支持条件输入。

### `POST /v1/upscale`

独立超分接口，不占用生成模型。

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `image` | string | — | 原始图片 base64，必填 |
| `target_edge` | int | `3840` | 目标长边像素 |
| `tile` | int | `384` | 分块尺寸，显存不足时调小 |

响应：

```json
{
  "b64_json": "<base64 PNG>",
  "width": 3840,
  "height": 2880,
  "source_width": 768,
  "source_height": 576
}
```

### 调用示例

```powershell
$body = @{
  model  = "moss-image-sft-turbo-up"
  prompt = "a cat sitting on a windowsill, sunlight, photorealistic"
  n      = 1
  size   = "2048x2048"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8188/v1/images/generations" `
  -Method Post -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer local" } -Body $body
```

```bash
curl -s http://127.0.0.1:8188/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local" \
  -d '{"model":"moss-image-sft-turbo","prompt":"a cat on a windowsill","n":1}'
```

---

## 性能数据

测试环境：RTX 3060 Laptop 6 GB / 16 GB DDR5 4800 / Windows 11。

### 生图（4.5 bit 量化）

| 变体 | 分辨率 | 步数 | 耗时 | 显存 |
| --- | --- | --- | --- | --- |
| `-turbo` | 512² | 4 | 33 秒 | 1.4 GB |
| `-turbo` | 768² | 4 | 17 秒 | 1.4 GB |
| `-turbo` | 1024² | 4 | 30 秒 | 1.6 GB |
| `-turbo` | 960² | 4 | 47 秒 | 1.4 GB |
| 原版 | 768² | 50 | 178 秒 | 1.4 GB |
| 原版 | 960² | 50 | 278 秒 | 1.4 GB |

4 步变体的文字渲染明显劣化，需要准确文字时使用 50 步。

### 超分（分块模式）

| 输入 | 输出 | 耗时 | 显存峰值 |
| --- | --- | --- | --- |
| 768×576 | 3072×2304 | 2.3 秒 | 3.62 GB |
| 1536×1536 | 6144×6144 | 16.4 秒 | 1.23 GB |
| 2048×2048 | 8192×8192 | 23.6 秒 | 1.23 GB |
| 768×576 | 3840×2880 | 10.9 秒 | 1.23 GB |

### 完整链路

| 流程 | 耗时 |
| --- | --- |
| 960² 生成（4 步）+ 超分 4K | 67 秒 |
| 512² 生成（4 步）+ 超分 2K | 42 秒 |
| 首次加载模型 | 7–15 秒 |

---

## 常见问题

### torch 装成了 CPU 版

`pip install diffsynth` 会从 PyPI 拉取 CPU 版 torch，覆盖已有的 CUDA 版。必须先装 torch，
再从 PyPI 装其余依赖。

cu124 索引最高仅到 torch 2.6.0，与 diffsynth 2.2.2 不兼容；使用 cu126。

### os error 1455

页面文件不足。DiT 反量化后约 10 GB 常驻 CPU 内存，加上编码器 5.56 GB 映射，超出 16 GB
物理内存。

```
系统属性 → 高级 → 性能设置 → 高级 → 虚拟内存 → 更改
→ 取消「自动管理」→ 选择空间充足的盘 → 自定义大小 24576 / 24576 → 设置 → 重启
```

需重启生效。

### Cannot detect the model type. File: []

VAE 或 tokenizer 路径不正确。按[安装步骤 3](#3-目录结构补齐)放置文件。

### DispatchError: No backend can handle 'lattice_rans'

缺少 CuPy。安装 `cupy-cuda12x[ctk]`；只装 `cupy-cuda12x` 会报
`Failed to find CUDA headers`。

### 进程崩溃，退出码 0xC0000005

使用了 `offload_dtype=torch.float8_e4m3fn`。CPU 不支持 fp8 反量化，改回 `bfloat16`。

### 生图速度异常慢

未传入 vram offload 配置，DiffSynth 默认将权重尽量放入 GPU，6 GB 显存不足后每步都需
换入换出。

| 配置 | 512² 4 步 | 显存 |
| --- | --- | --- |
| 默认 | 182.7 秒 | 5.87 GB |
| 显式 offload | 32.9 秒 | 1.37 GB |

```python
vram = {
    "offload_dtype": torch.bfloat16, "offload_device": "cpu",
    "onload_dtype": torch.bfloat16,  "onload_device": "cpu",
    "preparing_dtype": torch.bfloat16, "preparing_device": "cuda",
    "computation_dtype": torch.bfloat16, "computation_device": "cuda",
}
```

### 权重未找到 / 401

HF 上仓库名为 `OpenMOSS-Team/MOSS-Image-SFT`；`openmoss/MOSS-Image-SFT` 是魔搭命名，会返回 401。

EntroPack 量化包必须连同同名 `.json` sidecar 一起注册到 `MODEL_CONFIGS`，否则无法反量化。

### 页面白屏 / chunk 404

`output: "standalone"` 不会包含 `.next/static`，需单独复制：

```powershell
robocopy ".next\standalone" $dst /E
robocopy ".next\static" "$dst\.next\static" /E
```

### .cmd 输出大量 `'xxx' is not recognized`

cmd.exe 按 GBK 解析批处理文件，UTF-8 中文注释会被当作命令。`.cmd` 文件必须保持纯 ASCII。

### 创作台启动报 ENOTFOUND 127.0.0.1

`set VAR=value && next` 会把 `&&` 前的空格并入变量值。使用引号形式：

```cmd
set "HOSTNAME=127.0.0.1" && node server.js
```

### 健康检查通过但生图返回 500

模型加载失败。查看 8188 端口对应控制台的 traceback。

### `-up` 模型未出现

缺少 `models\upscale\RealESRGAN_x4plus.pth`。`UPSCALE_AVAILABLE` 为假时不会生成 `-up` 变体。

### 诊断命令

```powershell
# 服务状态
Invoke-RestMethod http://127.0.0.1:8188/health

# CUDA 可用性
env\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"

# 显存占用
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

# 端口监听
Get-NetTCPConnection -LocalPort 8188,3000 -State Listen
```

---

## 已知限制

| 限制 | 说明 |
| --- | --- |
| 不支持改图 | MOSS-Image 无图像编码器，`/v1/images/edits` 返回 501 |
| 不修正文字错误 | 超分只加像素，模糊文字放大后仍模糊 |
| 整图超分在 2048² 以上变慢 | 溢出至页面文件，应使用分块模式 |
| 队列不持久化 | 刷新页面清空，已完成作品不受影响 |
| 并发恒为 1 | 单卡资源限制 |
| 4.5 bit 量化有精度损失 | bf16 原版权重 27 GB，6 GB 显存无法容纳 |
| 小字需布局控制 | 未指定文字区域由模型自行生成 |
| 仅 Windows | 启动脚本为 `.cmd` + PowerShell；核心服务跨平台，需自行改写启动逻辑 |
| 视频功能未实现 | 创作台仅保留导航入口 |

---

## 许可证

本项目代码采用 MIT 许可证，见 `LICENSE`。

第三方组件遵循各自许可证：

| 组件 | 许可证 |
| --- | --- |
| MOSS-Image 权重与代码 | Apache-2.0 |
| DiffSynth-Studio | Apache-2.0 |
| RealESRGAN_x4plus | BSD-3-Clause |
| 4x-UltraSharp | CC-BY-4.0 |
| 4 步蒸馏 LoRA | Apache-2.0 |

生成内容的使用需遵守当地法律法规及模型许可证条款。

---

## 致谢

本项目建立在以下开源工作之上：

| 项目 | 作者 / 组织 | 用途 | 许可证 |
| --- | --- | --- | --- |
| [MOSS-Image](https://github.com/OpenMOSS/MOSS-Image) | OpenMOSS（复旦大学） | 文生图基础模型 | Apache-2.0 |
| [MOSS-Image EntroPack](https://huggingface.co/DiffSynth-Studio/MOSS-Image-EntroPack) | DiffSynth-Studio | 4.5 bit 量化权重与反量化实现 | Apache-2.0 |
| [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) | ModelScope（阿里巴巴） | 推理管线、层级别 offload | Apache-2.0 |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | Xintao Wang 等 | RRDBNet 超分网络与权重 | BSD-3-Clause |
| [4x-UltraSharp](https://openmodeldb.info/) | Kim2091 | 超分权重（备用） | CC-BY-4.0 |
| [PyTorch](https://pytorch.org/) | Meta AI | 深度学习框架 | BSD-3-Clause |
| [CUDA / CuPy](https://cupy.dev/) | NVIDIA / Preferred Networks | GPU 计算、EntroPack 熵解码 | Apache-2.0 |
| [FastAPI](https://fastapi.tiangolo.com/) | Sebastián Ramírez | 推理服务 HTTP 框架 | MIT |
| [Next.js](https://nextjs.org/) | Vercel | 创作台框架 | MIT |
| [React](https://react.dev/) | Meta | UI 库 | MIT |
| [Ant Design](https://ant.design/) | 蚂蚁集团 | UI 组件库 | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | Tailwind Labs | 样式框架 | MIT |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | OpenAI | 供应商客户端 | Apache-2.0 |
| [Vitest](https://vitest.dev/) | Anthony Fu 等 | 单元测试 | MIT |
| [Hugging Face Hub](https://huggingface.co/docs/huggingface_hub) | Hugging Face | 权重分发 | Apache-2.0 |

### 参考

- MOSS-Image 技术报告：<https://arxiv.org/abs/2610.23374>
- DiffSynth-Studio 低显存推理示例：`examples/moss_image/model_inference_low_vram/`

### 声明

本项目未包含上述组件的源码副本，仅通过依赖引用或权重下载使用。各组件的著作权归其
原作者所有，遵循各自的许可证条款。模型权重不在本仓库中分发，需按
[安装](#安装)一节自行下载。
