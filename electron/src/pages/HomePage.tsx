import { useEffect, useRef, useState } from "react";
import {
  listTemplates,
  startGenerateAsync,
  getTask,
  fileUrl,
  type TemplateInfo,
  type Task,
  type VideoGenerateRequest,
} from "@/lib/api";

type FlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; taskId: string; task: Task | null }
  | { kind: "done"; taskId: string; videoUrl: string; duration?: number }
  | { kind: "error"; message: string };

const DEFAULT_TEMPLATE_KEY = "1080x1920/image_default.html";

export function HomePage() {
  const [topic, setTopic] = useState("");
  const [nScenes, setNScenes] = useState(5);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const pollTimer = useRef<number | null>(null);

  // Fetch templates once on mount. Backend can return non-200 if config
  // hasn't been loaded yet — fail silently, the dropdown stays empty and
  // the default key is still submitted.
  useEffect(() => {
    let cancelled = false;
    listTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        /* leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cancel any in-flight poll loop when the flow leaves "running".
  useEffect(() => {
    if (flow.kind !== "running" && pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, [flow.kind]);

  async function pollOnce(taskId: string): Promise<void> {
    try {
      const task = await getTask(taskId);
      if (task.status === "completed") {
        const result = task.result as { video_path?: string } | null;
        const videoPath = result?.video_path;
        if (!videoPath) {
          setFlow({
            kind: "error",
            message: "Task hoàn thành nhưng không có video_path trong result",
          });
          return;
        }
        const url = await fileUrl(videoPath);
        setFlow({ kind: "done", taskId, videoUrl: url });
        return;
      }
      if (task.status === "failed" || task.status === "cancelled") {
        setFlow({
          kind: "error",
          message: task.error || `Task ${task.status}`,
        });
        return;
      }
      // Still running — update state + schedule next poll.
      setFlow((prev) =>
        prev.kind === "running" ? { ...prev, task } : prev,
      );
      pollTimer.current = window.setTimeout(() => pollOnce(taskId), 2000);
    } catch (err) {
      setFlow({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onGenerate() {
    if (!topic.trim()) return;
    setFlow({ kind: "starting" });
    try {
      const req: VideoGenerateRequest = {
        text: topic.trim(),
        mode: "generate",
        n_scenes: nScenes,
        frame_template: templateKey,
      };
      const resp = await startGenerateAsync(req);
      setFlow({ kind: "running", taskId: resp.task_id, task: null });
      // Kick off the polling loop. First call runs immediately so the
      // user sees "Đang chạy" right away — task manager may not have
      // updated status from pending → running yet, but the request did
      // land or we wouldn't have a task_id.
      pollOnce(resp.task_id);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err instanceof Error ? err.message : String(err));
      setFlow({ kind: "error", message: detail });
    }
  }

  function onReset() {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setFlow({ kind: "idle" });
  }

  const isBusy = flow.kind === "starting" || flow.kind === "running";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <section>
        <label className="block text-xs font-medium text-neutral-400 mb-2">
          Chủ đề video
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="VD: tại sao cá ngủ mà không nhắm mắt"
          rows={3}
          disabled={isBusy}
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
        />
      </section>

      <section className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            Số phân cảnh
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={nScenes}
            onChange={(e) => setNScenes(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            disabled={isBusy}
            className="w-24 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
          <label className="text-xs font-medium text-neutral-400">
            Template ({templates.length} có sẵn)
          </label>
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            disabled={isBusy}
            className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          >
            {templates.length === 0 ? (
              <option value={DEFAULT_TEMPLATE_KEY}>{DEFAULT_TEMPLATE_KEY}</option>
            ) : (
              templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key} ({t.orientation})
                </option>
              ))
            )}
          </select>
        </div>
      </section>

      <section>
        {flow.kind !== "running" && flow.kind !== "done" ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isBusy || !topic.trim()}
            className="rounded bg-emerald-700 px-5 py-2.5 text-sm font-medium text-emerald-50 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flow.kind === "starting" ? "Đang gửi..." : "Tạo video"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
          >
            Tạo video khác
          </button>
        )}
      </section>

      {flow.kind === "running" ? (
        <ProgressPanel task={flow.task} />
      ) : null}

      {flow.kind === "done" ? (
        <VideoResult videoUrl={flow.videoUrl} />
      ) : null}

      {flow.kind === "error" ? (
        <ErrorPanel message={flow.message} onReset={onReset} />
      ) : null}
    </div>
  );
}

function ProgressPanel({ task }: { task: Task | null }) {
  const pct = task?.progress?.percentage ?? 0;
  const message = task?.progress?.message || "Đang khởi động...";
  return (
    <section className="rounded border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-neutral-300">{message}</span>
        <span className="font-mono text-neutral-500">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-900">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      {task?.progress?.total ? (
        <div className="mt-1 text-[11px] text-neutral-600">
          {task.progress.current}/{task.progress.total}
        </div>
      ) : null}
    </section>
  );
}

function VideoResult({ videoUrl }: { videoUrl: string }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-emerald-900/50 bg-emerald-950/20 p-4">
      <div className="text-xs text-emerald-300">Hoàn thành</div>
      <video
        controls
        src={videoUrl}
        className="w-full max-h-[60vh] rounded bg-black"
      />
      <a
        href={videoUrl}
        download
        className="inline-block w-fit rounded border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/30"
      >
        Tải xuống
      </a>
    </section>
  );
}

function ErrorPanel({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <section className="rounded border border-red-900 bg-red-950/40 p-4 text-sm">
      <div className="font-medium text-red-200">Lỗi</div>
      <div className="mt-1 break-words text-red-200/80">{message}</div>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 rounded border border-red-800 px-3 py-1 text-xs text-red-200 hover:bg-red-900/40"
      >
        Thử lại
      </button>
    </section>
  );
}
