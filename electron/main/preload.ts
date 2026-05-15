/**
 * Preload script: exposes a typed, minimal IPC surface to the renderer.
 *
 * Renderer code can call ``window.baru.getApiBase()`` to learn where the
 * FastAPI server lives. Everything else flows over plain HTTP / SSE — no
 * IPC needed for the bulk of the app.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";

interface FileFilter {
  name: string;
  extensions: string[];
}

interface ChooseFileOptions {
  filters?: FileFilter[];
  title?: string;
}

interface MenuActionEvent {
  action: string;
}

interface UpdateCheckResult {
  status: "dev" | "up-to-date" | "downloading" | "skipped" | "error";
  currentVersion: string;
  remoteVersion?: string;
  message?: string;
}

type UpdateDownloadProgress =
  | {
      kind: "downloading";
      pct: number;
      loadedMb: number;
      totalMb: number;
      bytesPerSecond: number;
    }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

const baru = {
  /** Returns the base URL of the local FastAPI server, e.g. "http://127.0.0.1:5000". */
  getApiBase: (): Promise<string> => ipcRenderer.invoke("baru:get-api-base"),

  /** Returns the Electron app version (from electron/package.json). */
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke("baru:get-app-version"),

  /** Manually check GitHub Releases for a newer version. */
  checkUpdate: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("baru:check-update"),

  /** Subscribe to download progress while an update is downloading. */
  onUpdateDownloadProgress: (
    listener: (ev: UpdateDownloadProgress) => void,
  ): (() => void) => {
    const handler = (_e: unknown, payload: UpdateDownloadProgress) =>
      listener(payload);
    ipcRenderer.on("baru:update-download-progress", handler);
    return () => {
      ipcRenderer.off("baru:update-download-progress", handler);
    };
  },

  /** Open a folder/path in the OS default handler (File Explorer for dirs). */
  openPath: (path: string): Promise<string> =>
    ipcRenderer.invoke("baru:open-path", path),

  /** Open File Explorer with the given file highlighted/selected. */
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("baru:show-item", path),

  /** Native folder picker. Returns the chosen absolute path or null on cancel. */
  chooseFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("baru:choose-folder"),

  /** Native file picker. Returns the chosen absolute path or null on cancel. */
  chooseFile: (opts?: ChooseFileOptions): Promise<string | null> =>
    ipcRenderer.invoke("baru:choose-file", opts),

  /** Resolve a dropped File object → absolute path on disk.
   *  Replaces the deprecated ``file.path`` property which Electron 32+
   *  removed. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** Subscribe to native-menu actions dispatched from main. */
  onMenuAction: (listener: (ev: MenuActionEvent) => void): (() => void) => {
    const handler = (_e: unknown, payload: MenuActionEvent) => listener(payload);
    ipcRenderer.on("baru:menu", handler);
    return () => {
      ipcRenderer.off("baru:menu", handler);
    };
  },

  platform: process.platform,
} as const;

contextBridge.exposeInMainWorld("baru", baru);

export type BaruApi = typeof baru;
