import axios, { AxiosInstance } from "axios";

let baseURL: string | null = null;
let client: AxiosInstance | null = null;

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

export interface VideoGenerateRequest {
  text: string;
  mode?: "generate" | "fixed";
  n_scenes?: number;
  title?: string | null;
  frame_template?: string;
  prompt_prefix?: string | null;
  bgm_path?: string | null;
  bgm_volume?: number;
  tts_workflow?: string | null;
  video_fps?: number;
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
