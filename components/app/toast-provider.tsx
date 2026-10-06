"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  link?: { href: string; label: string };
  /** A button in the toast; pressing it runs `onClick` and dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Overrides how long the toast stays (actions need time to be pressed). */
  durationMs?: number;
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS: Record<ToastTone, number> = { success: 4000, info: 4000, error: 8000 };

const tones = {
  success: { Icon: CheckCircle2, className: "text-app-up" },
  error: { Icon: CircleAlert, className: "text-app-down" },
  info: { Icon: Info, className: "text-app-muted" },
} as const;

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context.toast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { ...input, id }]);
      window.setTimeout(() => dismiss(id), input.durationMs ?? DURATION_MS[input.tone]);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[340px] flex-col gap-2">
        {toasts.map(({ id, tone, title, message, link, action }) => {
          const { Icon, className } = tones[tone];
          return (
            <div
              key={id}
              role={tone === "error" ? "alert" : "status"}
              className="surface-menu pointer-events-auto flex gap-2.5 rounded-xl border border-app-hairline-strong bg-app-card px-3 py-2.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-app-ink">{title}</p>
                {message && <p className="mt-0.5 text-[12px] leading-snug text-app-muted">{message}</p>}
                {link && (
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12px] font-semibold text-app-ink underline">
                    {link.label}
                  </a>
                )}
                {action && (
                  <button
                    type="button"
                    onClick={() => {
                      dismiss(id);
                      action.onClick();
                    }}
                    className="mt-1.5 h-7 rounded-md bg-app-accent px-2.5 text-[12px] font-semibold text-app-on-accent hover:opacity-90"
                  >
                    {action.label}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(id)} aria-label="Dismiss" className="text-app-faint hover:text-app-ink">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
