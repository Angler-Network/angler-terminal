"use client";

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  onPointerUp?: () => void;
  disabled?: boolean;
  /** Values to mark on the track: thin breaks in it, at the thumb's center for that value. */
  marks?: number[];
  className?: string;
}

/** A break in the track at a position (0-1), in the panel color, as one background layer of the track. */
function markLayer(position: number) {
  const at = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${position})`;
  return `linear-gradient(to right, transparent calc(${at} - 1px), rgb(var(--app-card)) calc(${at} - 1px) calc(${at} + 1px), transparent calc(${at} + 1px))`;
}

/**
 * The app's slider: a native range input (keyboard, touch and screen readers keep working) drawn by `.range-slider`
 * in globals.css. `--p` is the value's position (0-1); the fill ends under the thumb's center.
 */
export function RangeSlider({ value, min, max, step = 1, label, onChange, onPointerUp, disabled, marks, className = "" }: RangeSliderProps) {
  const span = max - min || 1;
  const position = (point: number) => (Math.min(max, Math.max(min, point)) - min) / span;
  // The ends need no break: the track starts and stops there.
  const breaks = (marks ?? []).filter((mark) => mark > min && mark < max).map((mark) => markLayer(position(mark)));
  const style = { "--p": position(value), ...(breaks.length > 0 && { "--marks": breaks.join(", ") }) } as React.CSSProperties;
  return (
    <div className={`range-slider relative flex h-5 items-center ${className}`} style={style}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onPointerUp}
        className="range-slider-input"
      />
    </div>
  );
}
