# MOSS-Image → AIGC 创作台 接入说明

## 这东西是什么

一个本地 HTTP 服务，把 MOSS-Image 包装成**标准 OpenAI 生图接口**。

你的创作台本来就是「填 Base URL → 拉模型列表 → 调 `/v1/images/generations`」的通用客户端，
所以它不需要改一行代码：把它当成第三个"供应商"填进去就行。

```
创作台（Next.js :3000）
      │  POST /v1/images/generations
      ▼
本服务（FastAPI :8188）  ← 常驻进程，模型只加载一次
      │
      ▼
DiffSynth-Studio + MOSS-Image（CUDA，6GB 显存，层级别 offload）
```

**为什么不塞进 Next.js 路由**：模型要常驻内存（10GB+），Next 的请求生命周期管不住显存，
每条请求重新加载一次权重会慢到不可用。独立进程 + 协议对接才是正解。

---

## 一、装（只做一次）

### 1. 建 Python 环境

你系统里是 Python 3.14，**torch 还没有 3.14 的轮子**，必须单开一个 3.12 环境：

```powershell
conda create -n moss python=3.12 -y
conda activate moss
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

### 2. 装 DiffSynth-Studio

优先试 pip：

```powershell
pip install diffsynth
```

装不上（版本太旧/缺新模型）就从源码装：

```powershell
git clone https://github.com/modelscope/DiffSynth-Studio.git
cd DiffSynth-Studio
pip install -e .
```

### 3.（强烈建议）装 8 步加速 LoRA

50 步 → 8 步，6GB 卡上这是"能用"和"不能用"的分界。

```powershell
# 从魔搭或 HF 下 DiffSynth-Studio/MOSS-Image-SFT-TurboLoRA 里的 safetensors
# 假设存到 D:\models\moss-turbo-lora.safetensors，然后启动前设置：
set MOSS_TURBO_LORA=D:\models\moss-turbo-lora.safetensors
```

---

## 二、启动

双击 `start_moss_api.cmd`，看到这行就成了：

```
接口地址: http://127.0.0.1:8188/v1
```

**想先验证接线、不想等 10GB 下载**：把 `start_moss_api.cmd` 里 `set MOSS_MOCK=1` 那行的 `rem` 去掉，
服务会返回占位图（图上写着 prompt 和尺寸），用来确认整条链路通不通。

---

## 三、在创作台里接上

打开创作台 → **供应商**页 → 新增，填三个字段：

| 字段 | 填什么 |
|---|---|
| 名称 | `本地 MOSS-Image` |
| Base URL | `http://127.0.0.1:8188/v1` |
| 模型列表接口 | `/v1/models`（填绝对路径最稳，`/` 开头会拼到 origin 上） |
| API Key | 随便填，比如 `local`（服务端不校验，除非你设了 `MOSS_API_KEY`） |

点「体检」→ 应该提示 `连通正常，这把密钥能用 1 个模型`。
因为 `/v1/models` 返回了 `"type": "image"`，平台会自动把它归到**图片**类，不用你手改。

然后去 **生图**页：供应商选「本地 MOSS-Image」，模型选 `moss-image-sft-turbo`，写提示词，出图。
生成的图会自动进作品库（`persistImage` 会把 b64 落盘并登记），右键能定位到文件。

---

## 四、参数怎么填

| 平台里的项 | 实际效果 |
|---|---|
| 画幅 × 分辨率 | 会被服务端**等比压到长边 768**。平台给 3840×2160 也不会爆显存，只是输出小图 |
| `n` | 服务端串行跑 n 次，**别超过 2**：超时是 300 秒 |
| 质量 / 背景 / 风格 / 复杂度 | MOSS-Image 不认这些，服务端忽略，不报错 |
| 输出格式 | 固定返回 PNG（平台的 `sniffMime` 按字节判断，不受影响） |
| 改图模式 | 服务端返回 501 并说明原因 —— MOSS-Image 没有图像条件输入，做不了改图 |

### ⚠️ 300 秒超时

平台的 `makeImageClient` 超时是 **300 秒**（`src/lib/providers/client.ts`），超了前端就报失败。
所以：

- 768² + 8 步 ≈ 1–3 分钟 ✅
- 768² + 50 步 ≈ 8–15 分钟 ❌ 会被掐断
- `n=2` 等于时间翻倍 ⚠️

**结论：必须配 Turbo LoRA，且一次一张。** 实在没有 LoRA 就把 `MOSS_MAX_EDGE` 降到 512 并用 `n=1`。

---

## 五、环境变量速查

| 变量 | 默认 | 说明 |
|---|---|---|
| `MOSS_PORT` | 8188 | 监听端口 |
| `MOSS_MAX_EDGE` | 768 | 长边上限。6GB 别超 1024 |
| `MOSS_MODEL_ID` | `moss-image-sft` | 可选 `base` / `entropack`（4GB 量化档，最省显存） |
| `MOSS_TURBO_LORA` | 空 | 8 步 LoRA 路径，配了才出现 turbo 模型 |
| `MOSS_MOCK` | 空 | `1` = 不加载模型，返回占位图 |
| `MOSS_API_KEY` | 空 | 配了就校验 Bearer |

### 6GB 显存建议

显存吃紧时优先换量化档：

```
set MOSS_MODEL_ID=entropack
```

EntroPack 有 4.5bit / int8_6bit 等档位，最低 4GB 显存可跑（3060 是 sm_86，INT8 路径可用）。
具体档位文件名见仓库 `examples/moss_image/model_inference_low_vram/`。

---

## 六、出问题时看哪里

| 现象 | 原因 |
|---|---|
| 体检报"返回内容看不懂" | 端口不对，或服务没起。先浏览器开 `http://127.0.0.1:8188/health` |
| 模型被归成"对话" | `/v1/models` 的 `type` 字段丢了。手改模型用途也行（`kind_source=manual` 不会被覆盖） |
| 生图转圈到 300 秒失败 | 没装 Turbo LoRA，或 `n` 太大，或 `MOSS_MAX_EDGE` 太高 |
| `torch.cuda.is_available()` 为 False | 装成了 CPU 版 torch，重装用 cu124 的 index-url |
| 首次请求特别慢 | 正常：要下 10GB 权重。之后有缓存 |
| 显存爆 / 系统卡死 | 16GB 内存是瓶颈。关浏览器，或 `MOSS_MODEL_ID=entropack` |

---

## 七、如果以后想做成"一等公民"

现在这套是**零改动接入**。如果你希望 MOSS 出现在模型列表里带个「本地」标签、
或者生图页直接显示"本机显存 / 预计耗时"，那就需要动源码：

1. `src/lib/providers/presets.ts` 加一条 `本地 MOSS-Image` 预填（3 行）；
2. 想跳过 300 秒限制，就调大 `src/lib/providers/client.ts` 里 `makeImageClient` 的 timeout；
3. 想支持改图，得换模型（MOSS-Image 本身不支持）。

前两条都是小改，说一声我直接给你改。
