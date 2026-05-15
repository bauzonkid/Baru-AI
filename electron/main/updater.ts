/**
 * electron-updater integration — manual check, single-confirm flow.
 *
 * User flow per sếp's spec:
 *   1. User clicks "↻ Cập nhật" in the header → checkForUpdates()
 *   2. If newer version exists → OS dialog "Có bản X.Y.Z, tải về cài luôn?"
 *   3. User clicks "Tải về cài" → background download (with live
 *      progress streamed to the renderer via baru:update-download-progress)
 *   4. Download finishes → app restarts automatically into the new
 *      version (no second confirmation prompt)
 *
 * No auto-check on startup. No auto-download. Two ways the user can
 * cancel: pick "Để sau" in the confirm dialog, or close the app
 * before the download finishes.
 *
 * Disabled in dev (``app.isPackaged === false``).
 */

import { app, BrowserWindow, dialog } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import pkg from "electron-updater";

const { autoUpdater } = pkg;

let getWindowFn: (() => BrowserWindow | null) | null = null;

/** Logger for electron-updater that mirrors to <userData>/updater.log
 *  AND console. Without this, internal subprocess errors from execa
 *  show up as opaque "Check stderr output for details" with no way
 *  to see what actually went wrong. */
function installUpdaterLogger(): void {
  if (!app.isPackaged) return;
  const logDir = app.getPath("userData");
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  const logPath = path.join(logDir, "updater.log");
  const ts = () => new Date().toISOString();
  const write = (level: string, args: unknown[]) => {
    const line =
      `[${ts()} ${level}] ` +
      args
        .map((a) => {
          if (a instanceof Error) {
            return `${a.message}\n${a.stack ?? ""}`;
          }
          if (typeof a === "object") {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(" ") +
      "\n";
    try {
      appendFileSync(logPath, line);
    } catch {
      /* drop the line */
    }
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
  };
  autoUpdater.logger = {
    info: (...a: unknown[]) => write("INFO", a),
    warn: (...a: unknown[]) => write("WARN", a),
    error: (...a: unknown[]) => write("ERROR", a),
    debug: (...a: unknown[]) => write("DEBUG", a),
    log: (...a: unknown[]) => write("INFO", a),
  } as never;
  console.log(`[updater] logging to ${logPath}`);
}

function emitProgress(
  channel: string,
  payload: Record<string, unknown>,
): void {
  const w = getWindowFn?.();
  if (w && !w.isDestroyed()) {
    w.webContents.send(channel, payload);
  }
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  getWindowFn = getWindow;

  if (!app.isPackaged) {
    console.log("[updater] dev mode — manual check is a no-op");
    return;
  }

  installUpdaterLogger();
  // Manual control: caller decides when to download (after user
  // confirmation in manualCheckForUpdate). No background download.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] new version available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] up to date");
  });

  autoUpdater.on("error", (err) => {
    console.warn("[updater] error:", err);
    emitProgress("baru:update-download-progress", {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

  // Stream download progress to the renderer's UpdateButton so it
  // can render "Đang tải 45 / 220 MB" live.
  autoUpdater.on("download-progress", (info) => {
    emitProgress("baru:update-download-progress", {
      kind: "downloading",
      pct: (info.percent ?? 0) / 100,
      loadedMb: (info.transferred ?? 0) / 1e6,
      totalMb: (info.total ?? 0) / 1e6,
      bytesPerSecond: info.bytesPerSecond ?? 0,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log(`[updater] downloaded ${info.version} — restarting`);
    emitProgress("baru:update-download-progress", {
      kind: "installing",
      version: info.version,
    });
    // Per sếp's flow: user already said yes once at the check step.
    // Don't pester with a second dialog. Quit + install + relaunch.
    // Brief delay so the renderer can show the "Đang cài, app sẽ
    // khởi động lại..." status before NSIS UI takes over.
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 500);
  });

  // No automatic checkForUpdates() at startup.
}

/** Result returned from the renderer-driven check. */
export interface UpdateCheckResult {
  /** dev: unpackaged build (no-op).
   *  up-to-date: remote version <= installed.
   *  downloading: user confirmed, download has started — UI should
   *    subscribe to baru:update-download-progress for the live %.
   *  skipped: user clicked "Để sau" in the confirm dialog.
   *  error: check or download failed; message has details.
   */
  status: "dev" | "up-to-date" | "downloading" | "skipped" | "error";
  currentVersion: string;
  remoteVersion?: string;
  message?: string;
}

export async function manualCheckForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  if (!app.isPackaged) {
    return {
      status: "dev",
      currentVersion,
      message: "Auto-update disabled in dev mode",
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      return { status: "up-to-date", currentVersion };
    }
    const remote = result.updateInfo.version;
    if (remote === currentVersion) {
      return { status: "up-to-date", currentVersion, remoteVersion: remote };
    }

    // Single confirmation gate. The dialog is a hard sync block so
    // the rest of the flow (download → restart) is unambiguously
    // user-approved.
    const w = getWindowFn?.();
    const r = await dialog.showMessageBox(w ?? undefined!, {
      type: "info",
      title: "Baru-AI — Có bản mới",
      message: `Bản ${remote} đã sẵn sàng.`,
      detail:
        `Phiên bản hiện tại: ${currentVersion}\n\n` +
        "Tải về và cài luôn? App sẽ tự khởi động lại sau khi cài.",
      buttons: ["Tải về cài", "Để sau"],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) {
      return { status: "skipped", currentVersion, remoteVersion: remote };
    }

    // Fire-and-forget. Don't await: download takes 1-2 minutes for
    // ~220 MB. We return "downloading" now so the renderer can flip
    // the UpdateButton into a progress state. The progress events
    // (baru:update-download-progress) drive the live UI; the
    // ``update-downloaded`` handler triggers the auto-restart.
    autoUpdater.downloadUpdate().catch((err) => {
      console.error("[updater] downloadUpdate failed:", err);
      emitProgress("baru:update-download-progress", {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return { status: "downloading", currentVersion, remoteVersion: remote };
  } catch (err) {
    // electron-updater wraps execa errors that strip stderr from
    // .message ("Check stderr output for details"). Pull the raw
    // stderr / stdout / exitCode off the error object so the user
    // sees what actually failed.
    const e = err as {
      message?: string;
      code?: string;
      stderr?: string;
      stdout?: string;
      exitCode?: number;
      command?: string;
      stack?: string;
    };
    let message = e.message || String(err);
    if (e.stderr) message += `\n--stderr--\n${e.stderr.trim()}`;
    if (e.stdout) message += `\n--stdout--\n${e.stdout.trim()}`;
    if (e.code) message += `\n--code-- ${e.code}`;
    if (typeof e.exitCode === "number") message += ` exit=${e.exitCode}`;
    if (e.command) message += `\n--cmd-- ${e.command}`;
    console.error("[updater] check failed:", e.stack || message);

    // Pop a native error dialog so the user sees the full traceback
    // immediately — the small red ⚠ badge in the header is easy to
    // miss and tooltip text gets clipped on Windows. Also surface
    // the log file path so the user can copy + send to me.
    const logPath = path.join(app.getPath("userData"), "updater.log");
    const dlgMsg =
      `${message}\n\n` +
      `(Log đầy đủ ở: ${logPath})`;
    try {
      const w = getWindowFn?.();
      dialog.showMessageBox(w ?? undefined!, {
        type: "error",
        title: "Baru-AI — Lỗi check update",
        message: "Không check được bản mới.",
        detail: dlgMsg,
        buttons: ["Đóng"],
      });
    } catch {
      /* dialog might fail if no main window — keep silent */
    }
    return { status: "error", currentVersion, message };
  }
}
