import axios from "axios";

let baseURL: string | null = null;

async function getBase(): Promise<string> {
  if (baseURL) return baseURL;
  if (window.baru?.getApiBase) {
    baseURL = await window.baru.getApiBase();
  } else {
    baseURL = "http://127.0.0.1:5000";
  }
  return baseURL;
}

export interface PingResult {
  service: string;
  version: string;
}

export async function ping(): Promise<PingResult> {
  const base = await getBase();
  const r = await axios.get<PingResult>(`${base}/`, { timeout: 3000 });
  return r.data;
}
