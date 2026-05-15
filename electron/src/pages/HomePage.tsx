import { useEffect, useRef, useState } from "react";
import {
  listTemplates,
  listBgm,
  startGenerateAsync,
  getTask,
  type TemplateInfo,
  type BGMInfo,
  type Task,
  type VideoGenerateRequest,
} from "@/lib/api";

type FlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; taskId: string; task: Task | null }
  | { kind: "done"; taskId: string; videoUrl: string }
  | { kind: "error"; message: string };

type ScriptMode = "ai" | "fixed";

const DEFAULT_TEMPLATE_KEY = "1080x1920/image_default.html";
const DEFAULT_VOICE = "en-US-AriaNeural";

const EXAMPLES = [
  "Tại sao cá ngủ mà không nhắm mắt",
  "Atomic Habits — vì sao thay đổi nhỏ tạo kết quả lớn",
  "3 thói quen của người tự học hiệu quả",
];

// A small curated list — full Edge TTS list is 400+ voices, that's a
// future "voice browser" feature. For now sếp can paste any voice ID
// into Settings if these aren't enough.
const VOICE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "en-US-AriaNeural", label: "English (US) — Aria" },
  { id: "en-US-GuyNeural", label: "English (US) — Guy" },
  { id: "vi-VN-HoaiMyNeural", label: "Vietnamese — Hoài My" },
  { id: "vi-VN-NamMinhNeural", label: "Vietnamese — Nam Minh" },
  { id: "zh-CN-YunjianNeural", label: "Chinese (CN) — Yunjian" },
  { id: "ja-JP-NanamiNeural", label: "Japanese — Nanami" },
  { id: "ko-KR-SunHiNeural", label: "Korean — SunHi" },
];

export function HomePage() {
  const [topic, setTopic] = useState("");
  const [scriptMode, setScriptMode] = useState<ScriptMode>("ai");
  const [nScenes, setNScenes] = useState(5);
  const [bgmList, setBgmList] = useState<BGMInfo[]>([]);
  const [bgmPath, setBgmPath] = useState<string>(""); // "" = no BGM
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [speed, setSpeed] = useState(1.0);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listTemplates().catch(() => [] as TemplateInfo[]),
      listBgm().catch(() => [] as BGMInfo[]),
    ]).then(([tpls, bgms]) => {
      if (cancelled) return;
      setTemplates(tpls);
      setBgmList(bgms);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Backend's async endpoint returns ``{video_url, duration,
        // file_size}`` — video_url is already a full /api/files/...
        // URL, no fileUrl() wrap needed.
        const result = task.result as { video_url?: string } | null;
        const url = result?.video_url;
        if (!url) {
          setFlow({
            kind: "error",
            message: "Task hoàn thành nhưng không có video_url trong result",
          });
          return;
        }
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
        mode: scriptMode === "ai" ? "generate" : "fixed",
        n_scenes: scriptMode === "ai" ? nScenes : undefined,
        frame_template: templateKey,
        bgm_path: bgmPath || null,
        // tts_workflow null → backend uses inference_mode from config
      };
      const resp = await startGenerateAsync(req);
      setFlow({ kind: "running", taskId: resp.task_id, task: null });
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
  const canGenerate = !isBusy && topic.trim().length > 0;

  // Done state takes over the whole page: the 3-col input grid no
  // longer matters once a video exists, and sticking the result inside
  // a 240px column truncates both the player and its action buttons.
  if (flow.kind === "done") {
    return (
      <VideoDonePage videoUrl={flow.videoUrl} onReset={onReset} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <Hero />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr_1fr]">
        {/* ───────── Column 1: Script ─────────────────────────────── */}
        <Card title="Kịch bản" icon="📑">
          <Tabs
            value={scriptMode}
            options={[
              { value: "ai", label: "AI viết" },
              { value: "fixed", label: "Script có sẵn" },
            ]}
            onChange={(v) => setScriptMode(v as ScriptMode)}
            disabled={isBusy}
          />

          <Field
            label={scriptMode === "ai" ? "Chủ đề" : "Script đầy đủ"}
            hint={
              scriptMode === "ai"
                ? "Nhập 1 câu hoặc đoạn ngắn. AI sẽ viết script chi tiết."
                : "Paste sẵn — AI bỏ qua bước viết, dùng nguyên."
            }
          >
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={
                scriptMode === "ai"
                  ? "VD: tại sao cá ngủ mà không nhắm mắt"
                  : "Paste script ở đây..."
              }
              rows={scriptMode === "ai" ? 3 : 6}
              disabled={isBusy}
              className="w-full resize-none rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3.5 py-2.5 text-sm text-baru-fg placeholder:text-baru-muted focus:border-baru-violet/60 focus:outline-none focus:ring-1 focus:ring-baru-violet/40 disabled:opacity-50"
            />
          </Field>

          {scriptMode === "ai" ? (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setTopic(ex)}
                  disabled={isBusy}
                  className="rounded-baru-sm border border-baru-edge bg-baru-panel-3 px-2 py-1 text-[11px] text-baru-dim transition hover:border-baru-violet/40 hover:text-baru-fg disabled:opacity-40"
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}

          {scriptMode === "ai" ? (
            <Field label={`Số phân cảnh: ${nScenes}`}>
              <input
                type="range"
                min={1}
                max={15}
                value={nScenes}
                onChange={(e) => setNScenes(Number(e.target.value))}
                disabled={isBusy}
                className="w-full accent-baru-violet"
              />
            </Field>
          ) : null}

          <Field label="Nhạc nền (BGM)">
            <select
              value={bgmPath}
              onChange={(e) => setBgmPath(e.target.value)}
              disabled={isBusy}
              className="w-full rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3 py-2 text-sm text-baru-fg focus:border-baru-violet/60 focus:outline-none focus:ring-1 focus:ring-baru-violet/40 disabled:opacity-50"
            >
              <option value="">Không BGM</option>
              {bgmList.map((b) => (
                <option key={b.path} value={b.path}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        {/* ───────── Column 2: Voice + Template ───────────────────── */}
        <Card title="Giọng đọc & Template" icon="🎤">
          <Field label="Giọng đọc">
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={isBusy}
              className="w-full rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3 py-2 text-sm text-baru-fg focus:border-baru-violet/60 focus:outline-none focus:ring-1 focus:ring-baru-violet/40 disabled:opacity-50"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Tốc độ: ${speed.toFixed(2)}x`}>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              disabled={isBusy}
              className="w-full accent-baru-violet"
            />
          </Field>

          <div className="border-t border-baru-edge pt-4" />

          <Field
            label={`Template video (${templates.length || "đang tải"})`}
            hint="Quyết định layout + tỉ lệ video"
          >
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              disabled={isBusy}
              className="w-full rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3 py-2 text-sm text-baru-fg focus:border-baru-violet/60 focus:outline-none focus:ring-1 focus:ring-baru-violet/40 disabled:opacity-50"
            >
              {templates.length === 0 ? (
                <option value={DEFAULT_TEMPLATE_KEY}>{DEFAULT_TEMPLATE_KEY}</option>
              ) : (
                Object.entries(groupTemplates(templates)).map(([size, list]) => (
                  <optgroup
                    key={size}
                    label={`${size} (${labelForSize(size)})`}
                  >
                    {list.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          </Field>

          {selectedTemplateInfo(templates, templateKey) ? (
            <div className="rounded-baru-md bg-baru-panel-2 px-3 py-2 text-[11px] text-baru-muted">
              <span className="font-mono text-baru-dim">
                {selectedTemplateInfo(templates, templateKey)!.width}×
                {selectedTemplateInfo(templates, templateKey)!.height}
              </span>
              {" · "}
              {selectedTemplateInfo(templates, templateKey)!.orientation}
            </div>
          ) : null}
        </Card>

        {/* ───────── Column 3: Generate CTA + Result ───────────────── */}
        <Card title="Tạo video" icon="✨" highlighted>
          {flow.kind === "idle" || flow.kind === "starting" || flow.kind === "error" ? (
            <>
              <Summary
                topic={topic}
                scriptMode={scriptMode}
                nScenes={nScenes}
                voice={voice}
                speed={speed}
                templateKey={templateKey}
                bgmName={bgmList.find((b) => b.path === bgmPath)?.name}
              />
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                className="w-full rounded-baru-md bg-baru-violet px-4 py-3 text-sm font-medium text-white shadow-violet-glow transition hover:bg-baru-violet-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {flow.kind === "starting" ? "Đang gửi..." : "🎬  Tạo video"}
              </button>
              {!topic.trim() ? (
                <p className="text-[11px] text-baru-muted">
                  Cần nhập chủ đề trước
                </p>
              ) : null}
              {flow.kind === "error" ? (
                <ErrorInline message={flow.message} onReset={onReset} />
              ) : null}
            </>
          ) : (
            <ProgressInline task={flow.task} onCancel={onReset} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components

function Hero() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-display-lg text-baru-fg">Tạo video AI</h1>
      <p className="text-sm text-baru-dim">
        Nhập chủ đề. AI viết script, đọc lời, sinh ảnh từng cảnh, ghép thành
        video ngắn dạng dọc.
      </p>
    </header>
  );
}

function Card({
  title,
  icon,
  highlighted,
  children,
}: {
  title: string;
  icon?: string;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={[
        "flex flex-col gap-4 rounded-baru-lg border bg-baru-panel p-5",
        highlighted
          ? "border-baru-violet/30 lg:sticky lg:top-4 lg:self-start"
          : "border-baru-edge",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 text-label-xs uppercase text-baru-muted">
        {icon ? <span className="text-base">{icon}</span> : null}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Tabs({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1 rounded-baru-md border border-baru-edge bg-baru-panel-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={[
              "flex-1 rounded-baru-sm px-2.5 py-1.5 text-xs font-medium transition",
              active
                ? "bg-baru-violet text-white"
                : "text-baru-dim hover:text-baru-fg disabled:opacity-40",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-baru-dim">{label}</span>
      {children}
      {hint ? (
        <span className="text-[11px] text-baru-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function Summary({
  topic,
  scriptMode,
  nScenes,
  voice,
  speed,
  templateKey,
  bgmName,
}: {
  topic: string;
  scriptMode: ScriptMode;
  nScenes: number;
  voice: string;
  speed: number;
  templateKey: string;
  bgmName?: string;
}) {
  const voiceLabel =
    VOICE_OPTIONS.find((v) => v.id === voice)?.label || voice;
  return (
    <div className="rounded-baru-md bg-baru-panel-2 p-3 text-xs">
      <SummaryRow
        label="Chủ đề"
        value={topic.trim() || <em className="text-baru-muted">chưa nhập</em>}
      />
      <SummaryRow
        label="Chế độ"
        value={
          scriptMode === "ai" ? `AI viết · ${nScenes} cảnh` : "Script có sẵn"
        }
      />
      <SummaryRow label="Voice" value={voiceLabel} />
      <SummaryRow label="Tốc độ" value={`${speed.toFixed(2)}x`} />
      <SummaryRow label="Template" value={templateKey} />
      <SummaryRow label="BGM" value={bgmName || "Không"} />
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-baru-muted">{label}</span>
      <span className="truncate text-right text-baru-dim">{value}</span>
    </div>
  );
}

function ProgressInline({
  task,
  onCancel,
}: {
  task: Task | null;
  onCancel: () => void;
}) {
  const pct = task?.progress?.percentage ?? 0;
  const message = task?.progress?.message || "Đang khởi động...";
  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-baru-violet" />
        <span className="text-baru-fg">Đang xử lý</span>
      </div>
      <div className="text-xs text-baru-dim">{message}</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-baru-panel-3">
        <div
          className="h-full bg-baru-violet transition-[width] duration-300"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono text-baru-muted">
          {Math.round(pct)}%
          {task?.progress?.total
            ? `  ·  cảnh ${task.progress.current}/${task.progress.total}`
            : ""}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-baru-muted hover:text-baru-err"
        >
          Huỷ
        </button>
      </div>
    </>
  );
}

function VideoDonePage({
  videoUrl,
  onReset,
}: {
  videoUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
      {/* Top action bar — back button always visible, doesn't scroll off
          when the player + caption push down. */}
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 rounded-baru-md border border-baru-edge-bright bg-baru-panel-2 px-4 py-2 text-sm font-medium text-baru-fg transition hover:border-baru-violet/40 hover:text-white"
        >
          <span aria-hidden>←</span>
          <span>Tạo video khác</span>
        </button>
        <div className="flex items-center gap-2 text-xs text-baru-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-baru-ok" />
          <span>Hoàn thành</span>
        </div>
      </header>

      {/* Player — vertical 9:16 templates fit a max-h container nicely
          without overflowing on tall screens. */}
      <div className="rounded-baru-lg border border-baru-violet/30 bg-baru-panel p-4">
        <video
          controls
          autoPlay
          src={videoUrl}
          className="mx-auto block max-h-[70vh] w-auto max-w-full rounded-baru-md bg-black"
        />
      </div>

      {/* Action row — download + open in new tab. Bottom-of-page rather
          than overlaid so the player gets the full real estate. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <a
          href={videoUrl}
          download
          className="rounded-baru-md bg-baru-violet px-4 py-2 text-sm font-medium text-white shadow-violet-glow transition hover:bg-baru-violet-hover"
        >
          ⬇  Tải xuống
        </a>
        <a
          href={videoUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-baru-md border border-baru-edge-bright bg-baru-panel-2 px-4 py-2 text-sm text-baru-dim transition hover:border-baru-violet/40 hover:text-baru-fg"
        >
          Mở trong tab mới
        </a>
      </div>
    </div>
  );
}

function ErrorInline({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="rounded-baru-md border border-baru-err/40 bg-baru-err/5 p-3 text-xs">
      <div className="font-medium text-baru-err">Lỗi</div>
      <div className="mt-1 break-words text-baru-dim">{message}</div>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 rounded-baru-sm border border-baru-err/40 px-2 py-1 text-[11px] text-baru-fg hover:bg-baru-err/10"
      >
        Đóng
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function groupTemplates(list: TemplateInfo[]): Record<string, TemplateInfo[]> {
  return list.reduce<Record<string, TemplateInfo[]>>((acc, t) => {
    (acc[t.size] ||= []).push(t);
    return acc;
  }, {});
}

function labelForSize(size: string): string {
  if (size === "1080x1920") return "Dọc / Shorts";
  if (size === "1920x1080") return "Ngang / YouTube";
  if (size === "1080x1080") return "Vuông";
  return "";
}

function selectedTemplateInfo(
  list: TemplateInfo[],
  key: string,
): TemplateInfo | undefined {
  return list.find((t) => t.key === key);
}
