import type { ReactNode } from "react";

export type NavKey = "home" | "workspace";

interface NavItem {
  key: NavKey;
  label: string;
}

interface AppShellProps {
  children: ReactNode;
  topbarLeft?: ReactNode;
  topbarRight?: ReactNode;
  activeNav?: NavKey;
  onNavigate?: (key: NavKey) => void;
  showNav?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Trang chủ" },
  { key: "workspace", label: "Workspace" },
];

export function AppShell({
  children,
  topbarLeft,
  topbarRight,
  activeNav,
  onNavigate,
  showNav,
}: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-baru-bg text-baru-fg">
      <header className="flex h-12 items-center justify-between border-b border-baru-edge px-4">
        <div className="flex items-center gap-4">
          <span className="font-medium text-baru-fg">Baru-AI</span>
          {showNav && onNavigate ? (
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((it) => {
                const active = activeNav === it.key;
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onNavigate(it.key)}
                    className={[
                      "rounded-baru-sm px-2.5 py-1 text-xs font-medium transition",
                      active
                        ? "bg-baru-panel-3 text-baru-fg"
                        : "text-baru-dim hover:text-baru-fg",
                    ].join(" ")}
                  >
                    {it.label}
                  </button>
                );
              })}
            </nav>
          ) : null}
          {topbarLeft}
        </div>
        <div className="flex items-center gap-2">{topbarRight}</div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
