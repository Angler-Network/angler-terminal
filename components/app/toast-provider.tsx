"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { durations, ease, ENTER_PROPS } from "@/lib/motion";
import type { ToastPosition } from "@/lib/preferences";
import { usePreferences } from "./preferences-provider";
import { animateOut, useListEnter } from "./use-motion";

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

/**
 * Stack placement per `toastPosition`. Top stacks put the newest toast first (nearest the edge); phones keep the
 * bottom one above the tab bar.
 */
const placements: Record<ToastPosition, string> = {
  top: "inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex-col-reverse lg:inset-x-auto lg:left-1/2 lg:top-3 lg:w-[380px] lg:-translate-x-1/2",
  "top-right": "inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex-col-reverse lg:inset-x-auto lg:right-4 lg:top-3 lg:w-[340px]",
  "bottom-right": "inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] flex-col lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-[340px]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { preferences } = usePreferences();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const stackRef = useRef<HTMLDivElement>(null);
  const leaving = useRef(new Set<number>());
  // Top stacks are column-reverse, so a toast's DOM neighbours sit above it there.
  const fromTop = preferences.toastPosition !== "bottom-right";

  const dismiss = useCallback(
    (id: number) => {
      if (leaving.current.has(id)) return;
      leaving.current.add(id);
      const remove = () => {
        leaving.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      };
      const element = stackRef.current?.querySelector<HTMLElement>(`[data-motion-key="${id}"]`);
      // Collapse the toast and the 8px gap next to it, so the rest of the stack slides instead of jumping.
      const gapSide = element?.nextElementSibling ? (fromTop ? "marginTop" : "marginBottom") : fromTop ? "marginBottom" : "marginTop";
      const gap = element?.nextElementSibling || element?.previousElementSibling ? { [gapSide]: -8 } : {};
      animateOut(element, { opacity: 0, scale: 0.96, height: 0, paddingTop: 0, paddingBottom: 0, borderWidth: 0, ...gap }, remove);
    },
    [fromTop],
  );
  useListEnter(stackRef, toasts.map((toast) => String(toast.id)), "[data-motion-key]", (gsap, elements) =>
    gsap.from(elements, { opacity: 0, y: fromTop ? -14 : 14, scale: 0.96, duration: durations.base, ease: ease.out, clearProps: ENTER_PROPS }),
  );
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
      <div ref={stackRef} aria-live="polite" className={`pointer-events-none fixed z-50 flex gap-2 ${placements[preferences.toastPosition]}`}>
        {toasts.map(({ id, tone, title, message, link, action }) => {
          const { Icon, className } = tones[tone];
          return (
            <div
              key={id}
              data-motion-key={id}
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
