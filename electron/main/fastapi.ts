/**
 * Spawn + manage the FastAPI backend subprocess.
 *
 * Exposes ``startFastApi`` (called from main process startup) and
 * ``stopFastApi`` (called from main process teardown).
 */

import { spawn, ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const FASTAPI_PORT = 5000;

interface FastApiState {
  proc: ChildProcess | null;
  port: number;
}

const state: FastApiState = {
  proc: null,
  port: FASTAPI_PORT,
};

/**
 * Working directory for the FastAPI subprocess.
 *
 *   Dev:   project root ``D:\uSubaru\Baru-Pixelle\``
 *   Prod:  ``<resourcesPath>`` — electron-builder ships ``baru_api/`` +
 *          ``baru_pixelle/`` there via ``extraResources``.
 */
function projectRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // ``fileURLToPath`` is required on Windows — ``new URL().pathname`` returns
  // a leading-slash path like ``/D:/...`` which is invalid for ``path.resolve``.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..", "..");
}

/**
 * Resolve an absolute path to the Python interpreter.
 *
 *   Override: ``BARU_PYTHON`` env wins if set.
 *   Prod:     bundled embeddable Python at ``<resourcesPath>/python/python.exe``.
 *   Dev:      prefer ``electron/build/python/python.exe`` (matches prod deps),
 *             fall back to scanning PATH for ``python.exe`` / ``python3.exe``.
 *
 * Returning an absolute path bypasses Node spawn()'s PATHEXT resolution,
 * which silently fails with ENOENT in some launch contexts.
 */
function pythonExe(): string {
  if (process.env.BARU_PYTHON) return process.env.BARU_PYTHON;

  if (app.isPackaged) {
    return path.join(process.resourcesPath, "python", "python.exe");
  }

  const isWin = process.platform === "win32";

  // Dev mode preference: if the bundled env exists at
  // electron/build/python/python.exe (built via npm run bundle:python),
  // use it. Same Python + deps as prod — no surprise import errors.
  const devBundled = path.join(
    projectRoot(), "electron", "build", "python", "python.exe",
  );
  try {
    const s = statSync(devBundled);
    if (s.isFile()) return devBundled;
  } catch {
    /* not built yet — fall through to system Python scan */
  }

  // Scan PATH manually (windows: also check PATHEXT-style names).
  const candidates = isWin ? ["python.exe", "python3.exe"] : ["python3", "python"];
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        const s = statSync(full);
        if (s.isFile()) {
          // Skip the Microsoft Store stub at WindowsApps — 0-byte
          // placeholder that opens the Store rather than running Python.
          if (
            isWin &&
            full.toLowerCase().includes(
              path
                .join("appdata", "local", "microsoft", "windowsapps")
                .toLowerCase(),
            ) &&
            s.size < 1024
          ) {
            continue;
          }
          return full;
        }
      } catch {
        /* not present, continue */
      }
    }
  }
  return isWin ? "python.exe" : "python";
}

/** Wait for FastAPI to respond to GET / before resolving. */
async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 1000 },
        (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) < 500);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export interface StartFastApiOptions {
  /** Reserved for future runtime managers that prepend wherever pwsh/
   *  ffmpeg live. Currently a no-op; kept so the signature stays stable. */
  extraPathDirs?: string[];
}

export async function startFastApi(
  opts: StartFastApiOptions = {},
): Promise<{ port: number }> {
  if (state.proc) return { port: state.port };
  // Touch opts so TS noUnusedParameters stays quiet while preserving the
  // public API shape for callers.
  void opts;

  const cwd = projectRoot();
  const cmd = pythonExe();
  const args = [
    "-m",
    "uvicorn",
    "baru_api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(state.port),
    "--log-level",
    "warning",
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.BARU_USER_DATA = app.getPath("userData");
  env.PYTHONUNBUFFERED = "1";
  // Force UTF-8 for FastAPI stdout/stderr. Without this, Python uses
  // the OS locale and any print() with Vietnamese / emoji crashes with
  // UnicodeEncodeError.
  env.PYTHONIOENCODING = "utf-8";
  // Belt for dev-mode Python: pin sys.path so any Popen()'d child can
  // import baru_api / baru_pixelle regardless of cwd quirks. Packaged
  // build relies on python311._pth instead (embed Python ignores
  // PYTHONPATH in isolated mode).
  env.PYTHONPATH = cwd;

  const pathPrefix: string[] = [];
  if (app.isPackaged) {
    pathPrefix.push(path.join(process.resourcesPath, "python", "Scripts"));
    pathPrefix.push(path.join(process.resourcesPath, "ffmpeg"));
  }
  if (pathPrefix.length) {
    env.PATH = [...pathPrefix, env.PATH ?? ""].join(path.delimiter);
  }

  // Pipe FastAPI stdout+stderr to a file under userData when packaged.
  // Without this, packaged Electron has no console — Python tracebacks
  // vanish and we can't debug user reports.
  //
  // CRITICAL: hand spawn() a raw OS file descriptor (openSync), NOT a
  // Node Stream. With a Stream, Node forwards the pipe through its
  // event loop — on Windows the pipe fills during Python's import +
  // uvicorn banner and FastAPI blocks on print() before binding the
  // port.
  let logFd: number | null = null;
  let stdoutTarget: "inherit" | number = "inherit";
  let stderrTarget: "inherit" | number = "inherit";
  if (app.isPackaged) {
    const logDir = app.getPath("userData");
    mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "fastapi.log");
    // Lightweight rotation: if the log is >5MB, move to .1 before opening.
    try {
      if (existsSync(logPath) && statSync(logPath).size > 5 * 1024 * 1024) {
        renameSync(logPath, logPath + ".1");
      }
    } catch (err) {
      console.warn("[fastapi] log rotate failed:", err);
    }
    logFd = openSync(logPath, "a");
    writeSync(
      logFd,
      `\n=== FastAPI start ${new Date().toISOString()} (app v${app.getVersion()}) ===\n`,
    );
    stdoutTarget = logFd;
    stderrTarget = logFd;
    console.log(`[fastapi] logging to ${logPath}`);
  }

  console.log(`[fastapi] spawning: ${cmd} ${args.join(" ")} (cwd=${cwd})`);
  const proc = spawn(cmd, args, {
    cwd,
    env,
    stdio: ["ignore", stdoutTarget, stderrTarget],
    detached: false,
    windowsHide: true,
  });
  state.proc = proc;

  proc.on("exit", (code, signal) => {
    console.log(`[fastapi] exited code=${code} signal=${signal}`);
    state.proc = null;
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        /* fd already closed by spawn — ignore */
      }
      logFd = null;
    }
  });
  proc.on("error", (err) => {
    console.error("[fastapi] spawn error:", err);
  });

  const ready = await waitForServer(state.port, 30_000);
  if (!ready) {
    throw new Error(
      `FastAPI did not start within 30s on port ${state.port}. Check that ` +
        `'${cmd} -m uvicorn' works in your shell at ${cwd}.`,
    );
  }
  console.log(`[fastapi] ready on http://127.0.0.1:${state.port}`);
  return { port: state.port };
}

export async function stopFastApi(): Promise<void> {
  const proc = state.proc;
  if (!proc) return;
  console.log("[fastapi] stopping...");
  state.proc = null;
  try {
    proc.kill();
  } catch (err) {
    console.warn("[fastapi] kill failed:", err);
  }
}

export function getFastApiPort(): number {
  return state.port;
}
