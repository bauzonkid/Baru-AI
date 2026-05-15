# Baru-Pixelle

AI auto short-video engine — Electron desktop port of Pixelle-Video. The Python FastAPI backend (`baru_api`) is spawned as a sidecar by the Electron main process; future video/LLM/TTS/image pipeline logic lives in `baru_pixelle`.

## Dev setup

1. Install Python deps (from project root):

   ```
   uv sync
   ```

2. Install Node deps:

   ```
   cd electron
   npm install
   ```

3. Run the Electron app in dev mode:

   ```
   cd electron
   npm run dev
   ```
