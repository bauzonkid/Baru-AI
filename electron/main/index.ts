/**
 * Electron main process.
 *
 * Lifecycle:
 *   1. Open the BrowserWindow immediately (Python cold-start is slow).
 *   2. Spawn FastAPI subprocess in the background.
 *   3. Renderer's ping retries until FastAPI answers, then flips
 *      BackendPill green silently.
 *   4. On `before-quit` / `window-all-closed`: stop FastAPI + quit.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFastApi, stopFastApi } from "./fastapi.js";
import { buildMenu } from "./menu.js";
import { manualCheckForUpdate, setupAutoUpdater } from "./updater.js";

// Override the auto-derived app name so app.getPath("userData") returns
// %APPDATA%\Baru-AI\ instead of %APPDATA%\Baru-AI-electron\.
// MUST come before any app.getPath("userData") call — including those
// triggered by Electron internals during startup.
app.setName("Baru-AI");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the app icon (PNG; electron-builder auto-converts to .ico/.icns).
// In dev: source path. In built app: same relative layout (build/ shipped).
const APP_ICON = path.join(__dirname, "..", "..", "build", "icon.png");

// vite-plugin-electron sets these at build time so main can find the
// renderer entrypoint regardless of dev/build mode.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, "../../dist");

let mainWindow: BrowserWindow | null = null;
const fastapiPort = 5000;
let cleanupRan = false;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0a0a0a",
    title: "Baru-AI",
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external URLs in the user's browser, not a child Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function runCleanup(): void {
  if (cleanupRan) return;
  cleanupRan = true;
  console.log("[main] cleanup");
  void stopFastApi();
}

// ---- IPC: tell renderer where the FastAPI server is --------------------

ipcMain.handle("baru:get-api-base", () => `http://127.0.0.1:${fastapiPort}`);

// ---- IPC: app version + manual update check ---------------------------

ipcMain.handle("baru:get-app-version", () => app.getVersion());
ipcMain.handle("baru:check-update", () => manualCheckForUpdate());

// ---- IPC: filesystem reveal helpers ------------------------------------

ipcMain.handle("baru:open-path", async (_e, p: string) => {
  // Returns "" on success, error string on failure (per Electron docs).
  return shell.openPath(p);
});

ipcMain.handle("baru:show-item", async (_e, p: string) => {
  shell.showItemInFolder(p);
});

// ---- IPC: file/folder pickers ------------------------------------------

ipcMain.handle("baru:choose-folder", async () => {
  const w = mainWindow;
  if (!w) return null;
  const r = await dialog.showOpenDialog(w, {
    properties: ["openDirectory"],
    title: "Chọn folder",
  });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});

ipcMain.handle(
  "baru:choose-file",
  async (
    _e,
    opts: { filters?: Electron.FileFilter[]; title?: string } | undefined,
  ) => {
    const w = mainWindow;
    if (!w) return null;
    const r = await dialog.showOpenDialog(w, {
      properties: ["openFile"],
      title: opts?.title ?? "Chọn file",
      filters: opts?.filters,
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  },
);

// ---- App bootstrap -----------------------------------------------------

app.whenReady().then(async () => {
  // Install application menu (hidden behind autoHideMenuBar; Alt reveals).
  Menu.setApplicationMenu(buildMenu(() => mainWindow));

  await createWindow();

  startFastApi().catch((err) => {
    console.error("[main] FastAPI startup failed:", err);
  });

  // Kick off auto-update check in the background (no-op in dev).
  setupAutoUpdater(() => mainWindow);

  app.on("activate", async () => {
    // macOS: re-open window when dock icon clicked and no windows exist.
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  runCleanup();
  app.quit();
});

app.on("before-quit", runCleanup);
process.on("exit", runCleanup);
process.on("SIGINT", () => {
  runCleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  runCleanup();
  process.exit(0);
});
