"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

type AppShellProps = {
  title: string;
  eyebrow: string;
  description: string;
  children: React.ReactNode;
};

const navItems = [
  { href: "/calculator", label: "Client Intake" },
  { href: "/lenders", label: "Template Library" },
];

export function AppShell({
  title,
  eyebrow,
  description,
  children,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <main className="app-shell">
      <Toaster richColors position="top-right" />
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="glass-panel grid-board relative overflow-hidden rounded-[32px] p-6 sm:p-8">
          <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-[var(--accent-strong)]">
                {eyebrow}
              </p>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  {title}
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-[var(--muted)] sm:text-base">
                  {description}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-4 lg:items-end">
              <nav className="flex flex-wrap gap-2">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`rounded-full px-4 py-2 text-sm transition ${
                        isActive
                          ? "bg-[var(--accent)] text-white"
                          : "border border-[var(--line)] bg-white/60 text-[var(--foreground)] hover:bg-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--muted)]">
                  Workspace Mode
                </p>
                <p className="mt-2 max-w-xs text-[var(--foreground)]">
                  Broker workspace mode. Shared lender templates and saved intake files, no login required.
                </p>
              </div>
            </div>
          </div>
        </section>

        {children}
      </div>
    </main>
  );
}
