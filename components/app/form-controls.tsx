"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export { SelectField } from "./select-field";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Locked: shown but not clickable (e.g. a venue whose wallet isn't connected). */
  disabled?: boolean;
  /** Tooltip, e.g. why it's locked. */
  title?: string;
}

export function Toggle({ label, checked, onChange, disabled = false, title }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-app-ring/60 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-app-accent" : "bg-app-toggle-off"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

interface SettingRowProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-app-line py-4">
      <div className="min-w-0 flex-1 basis-[180px]">
        <p className="text-[15px] font-semibold text-app-ink">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}


interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 gap-1 rounded-xl border border-app-field-border bg-app-field p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-lg px-3.5 text-[14px] transition-colors ${
            option.value === value
              ? "bg-app-dialog font-semibold text-app-ink shadow-xs"
              : "text-app-muted hover:text-app-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface NumberStepperProps {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  className?: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}

export function NumberStepper({ label, value, min, max, step = 1, className = "", onChange, onCommit }: NumberStepperProps) {
  const t = useT();
  const decimals = (String(step).split(".")[1] ?? "").length;

  function nudge(direction: 1 | -1) {
    const current = Number(value);
    const base = Number.isFinite(current) && value !== "" ? current : min;
    const next = Math.min(max, Math.max(min, Math.round((base + direction * step) / step) * step)).toFixed(decimals);
    onChange(next);
    onCommit?.(next);
  }

  return (
    <div
      className={`flex h-10 items-center overflow-hidden rounded-xl border border-app-field-border bg-app-field text-app-ink transition-colors focus-within:ring-4 focus-within:ring-app-ring/60 hover:bg-app-field-hover ${className}`}
    >
      <input
        type="number"
        inputMode={decimals > 0 || min < 0 ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit?.(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && onCommit?.(event.currentTarget.value)}
        className="h-full min-w-0 flex-1 bg-transparent pl-4 text-[14px] tabular-nums outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="flex h-full w-8 shrink-0 flex-col border-l border-app-field-border">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("controls.increase", { name: label })}
          disabled={Number(value) >= max}
          onClick={() => nudge(1)}
          className="flex flex-1 items-center justify-center text-app-muted transition-colors hover:bg-app-field-border/50 hover:text-app-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("controls.decrease", { name: label })}
          disabled={Number(value) <= min}
          onClick={() => nudge(-1)}
          className="flex flex-1 items-center justify-center border-t border-app-field-border text-app-muted transition-colors hover:bg-app-field-border/50 hover:text-app-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
