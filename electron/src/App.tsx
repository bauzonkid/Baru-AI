import { useEffect, useState } from "react";
import { AppShell, type NavKey } from "@/components/AppShell";
import { LicenseGate } from "@/components/LicenseGate";
import { SettingsModal } from "@/components/SettingsModal";
import { HomePage } from "@/pages/HomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import {
  getLicenseStatus,
  ping,
  setLicenseInvalidHandler,
} from "@/lib/api";

type Backend =
  | { kind: "checking" }
  | { kind: "ok"; service: string; version: string }
  | { kind: "down"; reason: string };

type Gate =
  | { kind: "checking" }
  | { kind: "configured"; label: string | null }
  | { kind: "missing" };

export default function App() {
  const [backend, setBackend] = useState<Backend>({ kind: "checking" });
  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nav, setNav] = useState<NavKey>("home");

  // Ping FastAPI with retries. Cold-start Python can take 5-10s and
  // the main process spawns FastAPI in parallel with window open, so
  // the first ping might lose the race. Retry 30 × 1.5s = ~45s budget
  // before flipping to "down" — flashing red on transient misses is
  // noisy.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 30;

    async function tryOnce(): Promise<void> {
      try {
        const info = await ping();
        if (cancelled) return;
        setBackend({
          kind: "ok",
          service: info.service,
          version: info.version,
        });
      } catch (err) {
        if (cancelled) return;
        attempt += 1;
        if (attempt >= maxAttempts) {
          setBackend({
            kind: "down",
            reason: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        setTimeout(tryOnce, 1500);
      }
    }

    void tryOnce();
    return () => {
      cancelled = true;
    };
  }, []);

  // Global 451 handler — backend's license middleware returns 451 when
  // the saved license can't be verified. Drop back to LicenseGate so
  // sếp knows the tool is locked.
  useEffect(() => {
    setLicenseInvalidHandler((status, _err) => {
      console.warn("[license-gate] 451 from backend, status=", status);
      setGate({ kind: "missing" });
    });
    return () => setLicenseInvalidHandler(null);
  }, []);

  // After backend comes up, check whether a license is configured.
  useEffect(() => {
    if (backend.kind !== "ok") return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getLicenseStatus();
        if (cancelled) return;
        setGate(
          s.configured && s.last_status === "ok"
            ? { kind: "configured", label: s.label ?? null }
            : { kind: "missing" },
        );
      } catch {
        // Endpoint failed — treat as missing so user can paste key.
        if (cancelled) return;
        setGate({ kind: "missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend.kind]);

  const ready = backend.kind === "ok" && gate.kind === "configured";

  // Full-canvas LicenseGate when backend is ok but no valid license.
  // No AppShell wrapper — the gate is the entire screen.
  if (backend.kind === "ok" && gate.kind === "missing") {
    return (
      <LicenseGate
        onSuccess={(status) =>
          setGate({ kind: "configured", label: status.label ?? null })
        }
      />
    );
  }

  return (
    <AppShell
      activeNav={nav}
      onNavigate={setNav}
      showNav={ready}
      topbarLeft={<BackendPill state={backend} />}
      topbarRight={
        <>
          {ready ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
              title="Cấu hình"
            >
              Cấu hình
            </button>
          ) : null}
          <UpdateButton />
        </>
      }
    >
      {ready ? (
        nav === "workspace" ? (
          <WorkspacePage onPlay={() => { /* future: detail modal */ }} />
        ) : (
          <HomePage />
        )
      ) : backend.kind === "down" ? (
        <div className="mx-auto max-w-xl px-6 py-10">
          <div className="rounded-lg border border-red-900 bg-red-950/40 p-5 text-sm">
            <div className="font-medium text-red-200">
              Không kết nối được FastAPI
            </div>
            <div className="mt-2 text-red-200/80">{backend.reason}</div>
            <div className="mt-3 text-xs text-red-200/60">
              Backend được Electron tự spawn lúc app launch. Nếu lỗi này còn,
              mở DevTools (Ctrl+Shift+I) xem network log, hoặc chạy{" "}
              <code className="rounded bg-red-900/40 px-1">
                python -m uvicorn baru_api.main:app --port 5000
              </code>{" "}
              tay để xem stack trace.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-neutral-500">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
          <span className="text-xs">Đang khởi động backend...</span>
        </div>
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  );
}

function BackendPill({ state }: { state: Backend }) {
  if (state.kind === "checking") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-baru-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-baru-muted" />
        Đang kết nối...
      </span>
    );
  }
  if (state.kind === "down") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-baru-err"
        title={state.reason}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-baru-err" />
        Backend down
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-baru-dim">
      <span className="h-1.5 w-1.5 rounded-full bg-baru-ok" />
      Connected
      <span className="text-baru-muted">v{state.version}</span>
    </span>
  );
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "skipped"; remoteVersion: string }
  | {
      kind: "downloading";
      remoteVersion: string;
      pct: number;
      loadedMb: number;
      totalMb: number;
    }
  | { kind: "installing"; remoteVersion: string }
  | { kind: "error"; message: string }
  | { kind: "dev"; message?: string };

function UpdateButton() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    window.baru
      ?.getAppVersion?.()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        /* preload missing — leave null */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = window.baru?.onUpdateDownloadProgress?.((ev) => {
      if (ev.kind === "downloading") {
        setState((s) =>
          s.kind === "downloading" || s.kind === "checking"
            ? {
                kind: "downloading",
                remoteVersion:
                  s.kind === "downloading" ? s.remoteVersion : "?",
                pct: ev.pct,
                loadedMb: ev.loadedMb,
                totalMb: ev.totalMb,
              }
            : s,
        );
      } else if (ev.kind === "installing") {
        setState({ kind: "installing", remoteVersion: ev.version });
      } else if (ev.kind === "error") {
        setState({ kind: "error", message: ev.message });
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  // Auto-revert transient terminal states back to idle so the button
  // doesn't get stuck visually. Skip ongoing operations.
  useEffect(() => {
    if (
      state.kind === "up-to-date" ||
      state.kind === "skipped" ||
      state.kind === "error" ||
      state.kind === "dev"
    ) {
      const t = setTimeout(() => setState({ kind: "idle" }), 5000);
      return () => clearTimeout(t);
    }
  }, [state]);

  async function onClick() {
    if (
      state.kind === "checking" ||
      state.kind === "downloading" ||
      state.kind === "installing"
    )
      return;
    if (!window.baru?.checkUpdate) {
      setState({ kind: "error", message: "IPC chưa sẵn sàng" });
      return;
    }
    setState({ kind: "checking" });
    const r = await window.baru.checkUpdate();
    if (r.status === "downloading") {
      setState({
        kind: "downloading",
        remoteVersion: r.remoteVersion ?? "?",
        pct: 0,
        loadedMb: 0,
        totalMb: 0,
      });
    } else if (r.status === "skipped") {
      setState({ kind: "skipped", remoteVersion: r.remoteVersion ?? "?" });
    } else if (r.status === "up-to-date") {
      setState({ kind: "up-to-date" });
    } else if (r.status === "error") {
      setState({ kind: "error", message: r.message ?? "(unknown)" });
    } else {
      setState({ kind: "dev", message: r.message });
    }
  }

  const v = appVersion ?? "?";

  if (state.kind === "checking") {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-400"
        title={`v${v}`}
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-neutral-500 border-t-transparent" />
        Đang kiểm tra...
      </button>
    );
  }

  if (state.kind === "downloading") {
    const pct = Math.round(state.pct * 100);
    const sizeStr =
      state.totalMb > 0
        ? `${state.loadedMb.toFixed(0)}/${state.totalMb.toFixed(0)} MB`
        : "...";
    return (
      <div
        className="flex items-center gap-2 rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200"
        title={`Đang tải bản ${state.remoteVersion}. App sẽ tự khởi động lại sau khi cài.`}
      >
        <span>v{state.remoteVersion}</span>
        <span className="font-mono text-[10px] text-amber-300/80">
          {sizeStr}
        </span>
        <div className="h-1 w-16 overflow-hidden rounded bg-amber-950">
          <div
            className="h-full bg-amber-400 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (state.kind === "installing") {
    return (
      <span className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200">
        Đang cài v{state.remoteVersion}...
      </span>
    );
  }

  if (state.kind === "up-to-date") {
    return (
      <span className="rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300">
        Mới nhất (v{v})
      </span>
    );
  }

  if (state.kind === "skipped") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200"
        title={`Bản v${state.remoteVersion} chờ cài. Click để hiện hộp thoại lại.`}
      >
        v{v} · Bỏ qua
      </button>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-200"
        title={state.message}
      >
        Lỗi check update
      </button>
    );
  }

  if (state.kind === "dev") {
    return (
      <span
        className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-500"
        title={state.message ?? "Dev build — auto-update tắt"}
      >
        v{v} · dev
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
      title={`Phiên bản hiện tại: v${v}\nClick để kiểm tra bản mới`}
    >
      <span>v{v}</span>
    </button>
  );
}
