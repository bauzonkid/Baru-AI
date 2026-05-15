import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  topbarLeft?: ReactNode;
  topbarRight?: ReactNode;
}

export function AppShell({ children, topbarLeft, topbarRight }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-baru-bg text-baru-fg">
      <header className="flex h-12 items-center justify-between border-b border-baru-edge px-4">
        <div className="flex items-center gap-3">
          <span className="font-medium text-baru-fg">Baru-Pixelle</span>
          {topbarLeft}
        </div>
        <div className="flex items-center gap-2">{topbarRight}</div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
