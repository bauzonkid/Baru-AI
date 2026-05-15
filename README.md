# Baru-AI

AI auto short-video engine — Electron desktop port of [AIDC-AI/Pixelle-Video](https://github.com/AIDC-AI/Pixelle-Video) (Apache-2.0).

Nhập 1 chủ đề → AI sinh script → TTS → AI sinh ảnh từng cảnh → ffmpeg ghép thành video ngắn.

**Stack:** Electron 32 + Vite 5 + React 18 + TypeScript + Tailwind 3 (renderer) · FastAPI + Python 3.11 (sidecar, spawn từ Electron main) · electron-updater (auto-update qua GitHub releases).

**Onboarding rẻ nhất:** 1 API key Gemini từ [Google AI Studio](https://aistudio.google.com/apikey) → LLM (script) + Image gen (Nano Banana direct) đều xài chung key. TTS dùng Edge TTS local, không cần key.

## Dev setup

Yêu cầu: Python ≥3.11, uv, Node ≥20, ffmpeg trên PATH (chỉ cho dev — production bundle ffmpeg tự).

```bash
# 1. Python deps (project root)
uv sync
uv run playwright install chromium     # cho HTML→PNG renderer

# 2. Node deps
cd electron
npm install

# 3. (Lần đầu) Tạo config.yaml từ template, mở UI vào "Cấu hình" điền key sau
cd ..
cp config.example.yaml config.yaml

# 4. Dev mode
cd electron
BARU_PYTHON="../.venv/Scripts/python.exe" npm run dev
```

App mở cửa sổ "Baru-AI", backend pill xanh khi FastAPI sidecar boot xong (~3-5s).

## Production build

```bash
cd electron
npm run bundle:python      # Tải Python 3.11 embed + cài deps + bundle Chromium (~500MB)
npm run bundle:ffmpeg      # Tải ffmpeg/ffprobe static binary (~50MB)
npm run dist               # electron-builder → release/Baru-AI-Setup-X.Y.Z.exe
```

Output: `electron/release/Baru-AI-Setup-0.1.0.exe` (~700MB, NSIS installer cho phép user chọn thư mục cài).

## Release flow

Đẩy 1 phiên bản mới lên GitHub releases (user nhận auto-update qua electron-updater):

```bash
cd electron
npm run release:patch      # bump 0.1.0 → 0.1.1, tạo git tag, push
# hoặc release:minor / release:major
npm run publish            # build + electron-builder --publish always
```

**Yêu cầu:** repo GitHub `bauzonkid/Baru-AI` phải tồn tại, có `GH_TOKEN` env var với quyền `repo`.

## Cấu trúc

```
.
├── baru_api/               # FastAPI routers (25 endpoints: video gen, LLM, TTS, image, tasks, config, files, resources)
├── baru_ai/           # Core: services (llm/tts/media/video/frame), pipelines (standard/asset_based/custom), prompts, config
├── templates/              # 31 HTML frame templates (1080x1920 / 1920x1080 / 1080x1080)
├── workflows/              # ComfyUI workflow JSONs (advanced mode — selfhost + runninghub)
├── bgm/                    # Default BGM
├── electron/
│   ├── main/               # Electron main process: spawn FastAPI, IPC, auto-updater
│   ├── src/                # React renderer: HomePage + SettingsModal
│   └── scripts/            # bundle-python.mjs, bundle-ffmpeg.mjs, release.mjs
├── config.example.yaml     # → copy thành config.yaml, edit qua UI "Cấu hình"
└── pyproject.toml
```

## Inference modes

Cấu hình trong UI "Cấu hình" hoặc edit `config.yaml`:

| Service | Mode | Cần gì | Note |
|---|---|---|---|
| LLM | OpenAI-compat | Gemini key (free) hoặc OpenAI/Qwen/DeepSeek/Ollama | `llm.{api_key, base_url, model}` |
| Image | `gemini` | Gemini key | Nano Banana qua google-genai SDK, không cần ComfyUI |
| Image | `comfyui` | ComfyUI local hoặc RunningHub API key | Advanced, dùng workflow FLUX/SDXL/Qwen-Image v.v. |
| TTS | `local` | Không cần gì | Edge TTS — free, không API key |
| TTS | `comfyui` | ComfyUI workflow | Voice cloning, Index TTS v.v. |

## Acknowledgments

Port từ [AIDC-AI/Pixelle-Video](https://github.com/AIDC-AI/Pixelle-Video). Build script pattern lấy từ [bauzonkid/Baru-YTB](https://github.com/bauzonkid/Baru-YTB).
