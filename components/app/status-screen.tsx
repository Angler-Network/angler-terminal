import Link from "next/link";

interface StatusAction {
  href: string;
  label: string;
}

interface StatusScreenProps {
  /** Big mark above the title, such as "404". */
  mark?: string;
  title: string;
  description: string;
  primary: StatusAction;
  secondary?: StatusAction;
}

/**
 * Full-page message in the terminal's panel style (the 404): centered over a soft accent glow, with one main action.
 * Server-rendered; the entrance is CSS (`.status-in` in globals.css).
 */
export function StatusScreen({ mark, title, description, primary, secondary }: StatusScreenProps) {
  return (
    <section className="surface-panel relative flex h-full min-h-[420px] items-center justify-center overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55 p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_35%,rgb(var(--app-accent)/0.14),transparent_70%)]"
      />
      <div className="status-in relative flex max-w-[440px] flex-col items-center text-center">
        {mark && (
          <span
            aria-hidden
            className="mb-2 bg-linear-to-b from-app-ink to-app-ink/20 bg-clip-text text-[96px] font-semibold leading-none tracking-[-0.04em] text-transparent sm:text-[120px]"
          >
            {mark}
          </span>
        )}
        <h1 className="text-[26px] font-semibold leading-tight text-app-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-app-muted">{description}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Link
            href={primary.href}
            className="inline-flex h-10 items-center rounded-xl bg-app-accent px-5 text-[14px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
          >
            {primary.label}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              className="inline-flex h-10 items-center rounded-xl border border-app-hairline-strong px-5 text-[14px] font-semibold text-app-ink transition-colors hover:bg-app-chip"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
