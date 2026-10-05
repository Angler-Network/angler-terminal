"use client";

import { useLayoutEffect, useRef } from "react";

interface FitLabelProps {
  children: React.ReactNode;
  maxSize: number;
  minSize: number;
  className?: string;
}

export function FitLabel({ children, maxSize, minSize, className = "" }: FitLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const label = ref.current;
    if (!label) return;

    const fit = () => {
      if (!label.clientWidth) return;
      let size = maxSize;
      label.style.fontSize = `${size}px`;
      while (label.scrollWidth > label.clientWidth && size > minSize) {
        size -= 0.5;
        label.style.fontSize = `${size}px`;
      }
    };

    fit();
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(label);
    return () => observer.disconnect();
  }, [children, maxSize, minSize]);

  return (
    <span ref={ref} className={`w-full text-balance text-center leading-tight [word-break:keep-all] ${className}`}>
      {children}
    </span>
  );
}
