import axios, { AxiosInstance, AxiosError } from "axios";

let baseURL: string | null = null;
let client: AxiosInstance | null = null;

// Global callback fired when ANY backend call returns 451 — license-
// gate middleware says the saved license isn't currently valid.
// App.tsx subscribes via setLicenseInvalidHandler() so it can bounce
// the user back to LicenseGate without each call site reimplementing it.
type LicenseInvalidHandler = (
  status: string,
  error: string | null,
) => void;
let _licenseInvalidHandler: LicenseInvalidHandler | null = null;

export function setLicenseInvalidHandler(h: LicenseInvalidHandler | null): void {
  _licenseInvalidHandler = h;
}

async function getBase(): Promise<string> {
  if (baseURL) return baseURL;
  if (window.baru?.getApiBase) {
    baseURL = await window.baru.getApiBase();
  } else {
    baseURL = "http://127.0.0.1:5000";
  }
  return baseURL;
}

async function getClient(): Promise<AxiosInstance> {
  if (client) return client;
  const base = await getBase();
  client = axios.create({ baseURL: base, timeout: 60_000 });
  // 451 interceptor — fire the global handler, then let the original
  // rejection propagate so per-call error UI still runs.
  client.interceptors.response.use(
    (r) => r,
    (err: AxiosError) => {
      if (err.response?.status === 451) {
        const data = err.response.data as
          | { license_status?: string; license_error?: string }
          | undefined;
        _licenseInvalidHandler?.(
          data?.license_status || "unknown",
          data?.license_error || null,
        );
      }
      return Promise.reject(err);
    },
  );
  return client;
}

// ── Backend ping ────────────────────────────────────────────────────────────

export interface PingResult {
  service: string;
  version: string;
}

export async function ping(): Promise<PingResult> {
  const base = await getBase();
  const r = await axios.get<PingResult>(`${base}/`, { timeout: 3000 });
  return r.data;
}

// ── Resources ───────────────────────────────────────────────────────────────

export interface TemplateInfo {
  name: string;
  display_name: string;
  size: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  path: string;
  key: string;
}

export interface BGMInfo {
  name: string;
  path: string;
  size: number;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const c = await getClient();
  const r = await c.get<{ templates: TemplateInfo[] }>("/api/resources/templates");
  return r.data.templates ?? [];
}

export async function listBgm(): Promise<BGMInfo[]> {
  const c = await getClient();
  const r = await c.get<{ bgm: BGMInfo[] }>("/api/resources/bgm");
  return r.data.bgm ?? [];
}

// ── Video generation ────────────────────────────────────────────────────────

export type PipelineKind = "standard" | "asset_based" | "custom";

export interface VideoGenerateRequest {
  text: string;
  pipeline?: PipelineKind;
  mode?: "generate" | "fixed";
  n_scenes?: number;
  title?: string | null;
  frame_template?: string;
  prompt_prefix?: string | null;
  bgm_path?: string | null;
  bgm_volume?: number;
  tts_workflow?: string | null;
  media_workflow?: string | null;
  video_fps?: number;
  // Asset paths (set by file upload before invoking generate).
  // Different advanced modes pick different keys.
  assets?: string[];                // Custom Media / Image-to-Video
  character_assets?: string[];      // Digital Human
  video_assets?: string[];          // Action Transfer (reference video)
  image_assets?: string[];          // Action Transfer (character image)
}

export interface VideoGenerateAsyncResponse {
  success: boolean;
  message: string;
  task_id: string;
}

export async function startGenerateAsync(
  req: VideoGenerateRequest,
): Promise<VideoGenerateAsyncResponse> {
  const c = await getClient();
  const r = await c.post<VideoGenerateAsyncResponse>(
    "/api/video/generate/async",
    req,
  );
  return r.data;
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export interface UploadResult {
  paths: string[];
  batch_id: string;
}

/** Upload one or more files to the backend; returns absolute disk
 *  paths the generate request can reference (assets / character_assets
 *  / video_assets / image_assets). */
export async function uploadFiles(files: File[]): Promise<UploadResult> {
  if (!files.length) throw new Error("Chưa chọn file nào để upload");
  const base = await getBase();
  const form = new FormData();
  for (const f of files) {
    form.append("files", f, f.name);
  }
  // Use bare fetch — axios serialises FormData oddly across versions.
  const res = await fetch(`${base}/api/uploads`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let msg = `Upload thất bại (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = data.detail;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return (await res.json()) as UploadResult;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskProgress {
  current: number;
  total: number;
  percentage: number;
  message: string;
}

export interface Task {
  task_id: string;
  task_type: string;
  status: TaskStatus;
  progress: TaskProgress | null;
  result: unknown | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export async function getTask(taskId: string): Promise<Task> {
  const c = await getClient();
  const r = await c.get<Task>(`/api/tasks/${taskId}`);
  return r.data;
}

export async function cancelTask(taskId: string): Promise<void> {
  const c = await getClient();
  await c.delete(`/api/tasks/${taskId}`);
}

// ── File serving ────────────────────────────────────────────────────────────

/** Resolve a backend file path to a fetchable URL via /api/files. */
export async function fileUrl(relPath: string): Promise<string> {
  const base = await getBase();
  const clean = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  return `${base}/api/files/${clean}`;
}

// ── History (persistent workspace) ──────────────────────────────────────────

export interface HistoryItem {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  created_at?: string | null;
  completed_at?: string | null;
  // Flat shape — matches what persistence.list_tasks_paginated returns
  // (title / duration / n_frames / file_size / video_path at top level).
  title?: string | null;
  duration?: number;
  n_frames?: number;
  file_size?: number;
  video_path?: string;
  /** Filled by the server: ready-to-load /api/files/... URL when status=completed. */
  video_url?: string | null;
}

export interface HistoryPage {
  tasks: HistoryItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export async function listHistory(
  page: number = 1,
  pageSize: number = 50,
): Promise<HistoryPage> {
  const c = await getClient();
  const r = await c.get<HistoryPage>("/api/history", {
    params: { page, page_size: pageSize },
  });
  return r.data;
}

export async function deleteHistory(taskId: string): Promise<void> {
  const c = await getClient();
  await c.delete(`/api/history/${taskId}`);
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface LLMConfig {
  api_key: string;
  base_url: string;
  model: string;
}

export interface GeminiImageConfig {
  api_key: string;
  model: string;
}

export interface ImagenYohominConfig {
  license_key: string;
  base_url: string;
  aspect_ratio: string;
}

export type ImageMode = "imagen" | "gemini" | "comfyui";

export interface ImageSubConfig {
  inference_mode: ImageMode;
  imagen: ImagenYohominConfig;
  gemini: GeminiImageConfig;
  default_workflow: string | null;
  prompt_prefix: string;
}

export interface TTSLocalConfig {
  voice: string;
  speed: number;
}

export interface TTSSubConfig {
  inference_mode: "local" | "comfyui";
  local: TTSLocalConfig;
}

export interface BrandingConfig {
  author: string;
  describe: string;
  brand: string;
}

export interface AppConfig {
  project_name: string;
  llm: LLMConfig;
  comfyui: {
    comfyui_url: string;
    runninghub_api_key: string | null;
    tts: TTSSubConfig;
    image: ImageSubConfig;
    [key: string]: unknown;
  };
  template: {
    default_template: string;
    branding: BrandingConfig;
  };
}

export async function getConfig(): Promise<AppConfig> {
  const c = await getClient();
  const r = await c.get<AppConfig>("/api/config");
  return r.data;
}

export async function saveConfig(updates: Partial<AppConfig> | Record<string, unknown>): Promise<AppConfig> {
  const c = await getClient();
  const r = await c.post<AppConfig>("/api/config", { updates });
  return r.data;
}

// ── License gate ────────────────────────────────────────────────────────────

export interface LicenseStatus {
  configured: boolean;
  masked_key: string | null;
  label: string | null;
  last_status:
    | "active"
    | "revoked"
    | "not_found"
    | "device_mismatch"
    | "unreachable"
    | "ok"
    | "unknown";
  last_error: string | null;
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const c = await getClient();
  const r = await c.get<LicenseStatus>("/api/license-status");
  return r.data;
}

export async function setLicenseKey(key: string): Promise<LicenseStatus> {
  const c = await getClient();
  // Backend may return 400 with { detail: {status, error} } for revoked /
  // not_found / device_mismatch. Surface the error message so the gate
  // can render specific copy.
  try {
    const r = await c.post<LicenseStatus>("/api/license", { key });
    return r.data;
  } catch (err) {
    const ax = err as AxiosError;
    const detail = ax.response?.data as
      | { detail?: { status?: string; error?: string } | string }
      | undefined;
    if (detail?.detail && typeof detail.detail === "object") {
      const d = detail.detail;
      throw new Error(d.error || d.status || "license rejected");
    }
    throw err;
  }
}

export async function refreshLicense(): Promise<LicenseStatus> {
  const c = await getClient();
  const r = await c.post<LicenseStatus>("/api/license/refresh");
  return r.data;
}

export async function deleteLicense(): Promise<LicenseStatus> {
  const c = await getClient();
  const r = await c.delete<LicenseStatus>("/api/license");
  return r.data;
}
