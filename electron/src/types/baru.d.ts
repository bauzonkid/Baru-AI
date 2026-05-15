// Type declarations for the IPC surface exposed by electron/main/preload.ts.
// Preload is built as CJS so we can't `import type` from it across the
// renderer's ESM boundary — copy the interface by hand.

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

export interface BaruApi {
  getApiBase: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  checkUpdate: () => Promise<UpdateCheckResult>;
  onUpdateDownloadProgress: (
    listener: (ev: UpdateDownloadProgress) => void,
  ) => () => void;
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => Promise<void>;
  chooseFolder: () => Promise<string | null>;
  chooseFile: (opts?: ChooseFileOptions) => Promise<string | null>;
  getPathForFile: (file: File) => string;
  onMenuAction: (listener: (ev: MenuActionEvent) => void) => () => void;
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    baru?: BaruApi;
  }
}

export {};
