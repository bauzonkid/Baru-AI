import { useEffect, useState } from "react";
import {
  listHistory,
  deleteHistory,
  type HistoryItem,
} from "@/lib/api";

interface Props {
  onPlay: (videoUrl: string) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; items: HistoryItem[]; total: number }
  | { kind: "error"; message: string };

export function WorkspacePage({ onPlay }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  async function reload() {
    setState({ kind: "loading" });
    try {
      const data = await listHistory(1, 100);
      setState({ kind: "loaded", items: data.tasks, total: data.total });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onDelete(taskId: string) {
    if (!confirm("Xóa task này khỏi đĩa? Không khôi phục được.")) return;
    try {
      await deleteHistory(taskId);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-6 py-16 text-baru-muted">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-baru-edge border-t-baru-violet" />
        <span className="text-xs">Đang tải workspace...</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="rounded-baru-md border border-baru-err/40 bg-baru-err/5 p-5 text-sm">
          <div className="font-medium text-baru-err">Không load được lịch sử</div>
          <div className="mt-1 text-baru-dim">{state.message}</div>
          <button
            type="button"
            onClick={reload}
            className="mt-3 rounded-baru-sm border border-baru-err/40 px-3 py-1 text-xs text-baru-fg hover:bg-baru-err/10"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-20 text-center">
        <div className="text-display-lg text-baru-fg">Chưa có video nào</div>
        <p className="text-sm text-baru-dim">
          Video sếp tạo sẽ hiện ở đây. Quay lại trang chủ, nhập chủ đề và
          bấm "Tạo video".
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-lg text-baru-fg">Workspace</h1>
          <p className="text-sm text-baru-dim">
            {state.total} video đã render — sắp xếp mới nhất trước.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3 py-1.5 text-xs text-baru-dim hover:text-baru-fg"
        >
          ↻ Làm mới
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.items.map((it) => (
          <HistoryCard
            key={it.task_id}
            item={it}
            onPlay={onPlay}
            onDelete={() => onDelete(it.task_id)}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryCard({
  item,
  onPlay,
  onDelete,
}: {
  item: HistoryItem;
  onPlay: (url: string) => void;
  onDelete: () => void;
}) {
  const completed = item.status === "completed" && item.video_url;
  const title = (item.title && item.title.trim()) || item.task_id;
  const duration = item.duration;
  const nScenes = item.n_frames;
  const fileMB = item.file_size
    ? (item.file_size / (1024 * 1024)).toFixed(1)
    : null;
  const when = item.completed_at || item.created_at;

  return (
    <article className="flex flex-col gap-3 rounded-baru-lg border border-baru-edge bg-baru-panel p-4 transition hover:border-baru-edge-bright">
      <div className="overflow-hidden rounded-baru-md bg-black aspect-[9/16]">
        {completed ? (
          <video
            src={item.video_url!}
            preload="metadata"
            controls
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-baru-muted text-xs">
            {item.status === "failed"
              ? "Lỗi render"
              : item.status === "running"
                ? "Đang chạy"
                : item.status}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div
          className="line-clamp-2 text-sm text-baru-fg"
          title={title}
        >
          {title}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-baru-muted">
          <StatusDot status={item.status} />
          <span>{statusLabel(item.status)}</span>
          {duration ? <span>· {duration.toFixed(1)}s</span> : null}
          {nScenes ? <span>· {nScenes} cảnh</span> : null}
          {fileMB ? <span>· {fileMB} MB</span> : null}
        </div>
        {when ? (
          <div className="text-[11px] text-baru-muted">
            {formatWhen(when)}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {completed ? (
          <>
            <button
              type="button"
              onClick={() => onPlay(item.video_url!)}
              className="flex-1 rounded-baru-md bg-baru-violet px-3 py-1.5 text-xs font-medium text-white hover:bg-baru-violet-hover"
            >
              ▶  Xem
            </button>
            <a
              href={item.video_url!}
              download
              className="rounded-baru-md border border-baru-edge-bright bg-baru-panel-2 px-3 py-1.5 text-xs text-baru-dim hover:text-baru-fg"
              title="Tải xuống"
            >
              ⬇
            </a>
          </>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          className="rounded-baru-md border border-baru-edge bg-baru-panel-2 px-3 py-1.5 text-xs text-baru-muted hover:border-baru-err/40 hover:text-baru-err"
          title="Xóa"
        >
          🗑
        </button>
      </div>
    </article>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-baru-ok"
      : status === "failed" || status === "cancelled"
        ? "bg-baru-err"
        : status === "running" || status === "pending"
          ? "bg-baru-warn"
          : "bg-baru-muted";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Hoàn thành";
    case "failed":
      return "Lỗi";
    case "cancelled":
      return "Đã hủy";
    case "running":
      return "Đang chạy";
    case "pending":
      return "Chờ";
    default:
      return status;
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
