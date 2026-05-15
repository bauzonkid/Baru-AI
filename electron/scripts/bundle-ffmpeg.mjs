#!/usr/bin/env node
/**
 * Bundle ffmpeg + ffprobe binaries from BtbN/FFmpeg-Builds (GPL static
 * build — no DLLs).
 *
 * Output:
 *   electron/build/ffmpeg/
 *   ├── ffmpeg.exe
 *   └── ffprobe.exe
 *
 * extraResources copies this whole tree into <resources>/ffmpeg/ in
 * the installed app. main/fastapi.ts prepends that dir to the
 * FastAPI subprocess's PATH so subprocess.run(["ffmpeg"|"ffprobe"])
 * inside Python (yt-dlp merge, transcribe, render, preview) finds
 * them without requiring a system install.
 *
 * Idempotent: skips download if both .exe files already exist. Pass
 * ``--clean`` to force a fresh download.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = path.resolve(__dirname, "..");
const FFMPEG_DIR = path.join(ELECTRON, "build", "ffmpeg");
const FFMPEG_EXE = path.join(FFMPEG_DIR, "ffmpeg.exe");
const FFPROBE_EXE = path.join(FFMPEG_DIR, "ffprobe.exe");

const URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";
const ZIP = path.join(FFMPEG_DIR, "_download.zip");
const TMP = path.join(FFMPEG_DIR, "_extract");

const args = process.argv.slice(2);
if (args.includes("--clean") && existsSync(FFMPEG_DIR)) {
  console.log("[ffmpeg] --clean: removing existing build/ffmpeg/");
  rmSync(FFMPEG_DIR, { recursive: true, force: true });
}

if (existsSync(FFMPEG_EXE) && existsSync(FFPROBE_EXE)) {
  const sFf = (statSync(FFMPEG_EXE).size / 1e6).toFixed(1);
  const sFp = (statSync(FFPROBE_EXE).size / 1e6).toFixed(1);
  console.log(
    `[ffmpeg] already bundled (${sFf}MB ffmpeg + ${sFp}MB ffprobe). Use --clean to refresh.`,
  );
  process.exit(0);
}

mkdirSync(FFMPEG_DIR, { recursive: true });

console.log(`[ffmpeg] downloading ${URL}`);
execSync(`curl -fL --progress-bar -o "${ZIP}" "${URL}"`, { stdio: "inherit" });

console.log("[ffmpeg] extracting (PowerShell Expand-Archive)...");
mkdirSync(TMP, { recursive: true });
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path '${ZIP}' -DestinationPath '${TMP}' -Force"`,
  { stdio: "inherit" },
);

const inner = readdirSync(TMP).filter((n) =>
  statSync(path.join(TMP, n)).isDirectory(),
)[0];
if (!inner) {
  throw new Error("[ffmpeg] no inner folder found inside extracted ZIP");
}
const binDir = path.join(TMP, inner, "bin");
renameSync(path.join(binDir, "ffmpeg.exe"), FFMPEG_EXE);
renameSync(path.join(binDir, "ffprobe.exe"), FFPROBE_EXE);

console.log("[ffmpeg] cleanup tmp...");
rmSync(ZIP, { force: true });
rmSync(TMP, { recursive: true, force: true });

const sFf = (statSync(FFMPEG_EXE).size / 1e6).toFixed(1);
const sFp = (statSync(FFPROBE_EXE).size / 1e6).toFixed(1);
console.log(
  `[ffmpeg] done. ffmpeg.exe (${sFf}MB) + ffprobe.exe (${sFp}MB) at ${FFMPEG_DIR}`,
);
