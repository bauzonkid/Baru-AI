/**
 * Login-style screen that gates the entire app behind a valid
 * license key. Rendered when ``getLicenseStatus()`` reports the
 * user has no key on disk, or when a backend call returns 451.
 *
 * Visual: "Quiet Precision" design system (violet accent on near-
 * black canvas). Same gate Baru-YTB uses — sếp's license key works
 * for both apps.
 */

import { useEffect, useState } from "react";
import { setLicenseKey, type LicenseStatus } from "@/lib/api";

interface LicenseGateProps {
  onSuccess: (status: LicenseStatus) => void;
}

export function LicenseGate({ onSuccess }: LicenseGateProps) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    window.baru
      ?.getAppVersion?.()
      .then((v) => setVersion(v))
      .catch(() => {
        /* dev / preload missing — leave blank */
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k || busy) return;

    setBusy(true);
    setError(null);
    try {
      const next = await setLicenseKey(k);
      if (next.configured && next.last_status === "ok") {
        onSuccess(next);
        return;
      }
      if (next.last_status === "unreachable") {
        setError(
          "Server license tạm thời không phản hồi. Sếp thử lại sau ít giây.",
        );
        return;
      }
      setError(`Không xác thực được key (${next.last_status}).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not_found")) {
        setError("Key không tồn tại. Sếp kiểm tra lại hoặc liên hệ admin.");
      } else if (msg.includes("device_mismatch")) {
        setError(
          "Key này đang bind với máy khác. Liên hệ admin để reset device hoặc cấp key mới.",
        );
      } else if (msg.includes("revoked")) {
        setError("Key đã bị thu hồi. Liên hệ admin để cấp key mới.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100vh] items-center justify-center bg-baru-bg p-4">
      {/* Subtle violet mesh background — two soft blurs suggest depth
          without painting it. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40vw] w-[40vw] rounded-full bg-baru-violet/[0.08] blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] h-[30vw] w-[30vw] rounded-full bg-baru-violet-soft/[0.05] blur-[100px]" />
      </div>

      <main className="w-full max-w-[420px]">
        <div className="flex flex-col gap-6 rounded-baru-xl border border-baru-edge bg-baru-panel p-10 shadow-panel-float">
          <header className="flex flex-col items-center gap-2 text-center">
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-baru-xl border border-baru-edge-bright bg-baru-panel-3">
              <FilmStripIcon className="h-9 w-9 text-baru-violet" />
            </div>
            <h1 className="text-display-lg text-baru-fg">Baru-AI</h1>
            <p className="text-sm text-baru-dim/80">
              Tạo video ngắn AI từ một chủ đề
            </p>
          </header>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="license-key"
                className="px-1 text-label-xs uppercase tracking-widest text-baru-dim"
              >
                Mã License
              </label>
              <div className="relative">
                <KeyIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-baru-muted" />
                <input
                  id="license-key"
                  type="text"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={busy}
                  className={
                    "w-full rounded-baru-md border bg-baru-panel-2 py-3 pl-11 pr-4 " +
                    "font-mono text-[13px] text-baru-fg placeholder-baru-muted/60 " +
                    "transition-colors outline-none " +
                    "border-baru-edge focus:border-baru-violet focus:bg-baru-panel-2 " +
                    "disabled:cursor-not-allowed disabled:opacity-60"
                  }
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-baru-md border border-baru-err/40 bg-baru-err/[0.08] px-3 py-2 text-[12px] text-baru-err">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!keyInput.trim() || busy}
              className={
                "flex items-center justify-center gap-2 rounded-baru-md py-3 " +
                "text-[15px] font-medium text-white " +
                "bg-baru-violet hover:bg-baru-violet-hover " +
                "shadow-violet-glow " +
                "transition-all active:scale-[0.985] " +
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              }
            >
              <span>{busy ? "Đang xác thực..." : "Đăng nhập"}</span>
              {!busy && <LoginArrowIcon className="h-4 w-4" />}
            </button>
          </form>

          <div className="h-px w-full bg-baru-edge" />

          <footer className="flex flex-col gap-3 text-center">
            <div className="flex items-start justify-center gap-2 text-baru-dim/70">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-left text-[12px] leading-relaxed">
                Liên hệ admin để xin license cho Baru-AI. Key được lưu
                trên máy này — không cần nhập lại. Mỗi tool (Baru-YTB,
                Baru-Manga, Baru-AI) dùng license riêng.
              </p>
            </div>
            <div className="flex items-center justify-center gap-6 pt-1">
              <a
                href="https://t.me/usubaruu"
                target="_blank"
                rel="noopener noreferrer"
                title="Nhắn admin trên Telegram (@usubaruu)"
                className="flex items-center gap-1.5 text-label-xs text-baru-violet hover:underline"
              >
                <SupportIcon className="h-3.5 w-3.5" />
                Hỗ trợ
              </a>
              <span className="text-label-xs text-baru-muted">
                {version ? `v${version}` : ""}
              </span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function FilmStripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 8h18" />
      <path d="M3 16h18" />
      <path d="M8 3v18" />
      <path d="M16 3v18" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="m10 13 8.4-8.4" />
      <path d="m17 7 2 2" />
      <path d="m14 10 2 2" />
    </svg>
  );
}

function LoginArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function SupportIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
