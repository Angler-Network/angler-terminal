import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sora)", "system-ui", "sans-serif"],
      },
      colors: {
        app: {
          accent: "rgb(var(--app-accent) / <alpha-value>)",
          card: "rgb(var(--app-card) / <alpha-value>)",
          chip: "rgb(var(--app-chip) / <alpha-value>)",
          danger: "rgb(var(--app-danger) / <alpha-value>)",
          dialog: "rgb(var(--app-dialog) / <alpha-value>)",
          down: "rgb(var(--app-down) / <alpha-value>)",
          faint: "rgb(var(--app-faint) / <alpha-value>)",
          field: "rgb(var(--app-field) / <alpha-value>)",
          "field-border": "rgb(var(--app-field-border) / <alpha-value>)",
          "field-hover": "rgb(var(--app-field-hover) / <alpha-value>)",
          focus: "rgb(var(--app-focus) / <alpha-value>)",
          hairline: "rgb(var(--app-hairline) / <alpha-value>)",
          "hairline-strong": "rgb(var(--app-hairline-strong) / <alpha-value>)",
          ink: "rgb(var(--app-ink) / <alpha-value>)",
          line: "rgb(var(--app-line) / <alpha-value>)",
          muted: "rgb(var(--app-muted) / <alpha-value>)",
          "on-accent": "rgb(var(--app-on-accent) / <alpha-value>)",
          panel: "rgb(var(--app-panel) / <alpha-value>)",
          ring: "rgb(var(--app-ring) / <alpha-value>)",
          selected: "rgb(var(--app-selected) / <alpha-value>)",
          "shell-bottom": "rgb(var(--app-shell-bottom) / <alpha-value>)",
          "shell-top": "rgb(var(--app-shell-top) / <alpha-value>)",
          "toggle-off": "rgb(var(--app-toggle-off) / <alpha-value>)",
          up: "rgb(var(--app-up) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
