/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy accent — kept so the rest of the app (still on the
        // old orange theme) doesn't visually break while we
        // incrementally redesign each screen onto the new tokens.
        accent: "#FF6B35",

        // ── Quiet Precision design system ─────────────────────────
        // Violet accent for active states, primary CTAs, focus rings.
        // Replaces the orange accent on screens that have been
        // redesigned (LicenseGate first, then InputPage, etc.).
        baru: {
          // Surfaces, layered tonally instead of via shadows.
          bg: "#0A0A0A",          // canvas / Level 0
          fg: "#E7E0ED",          // primary text (on-surface)
          dim: "#CBC3D7",         // secondary text (on-surface-variant)
          muted: "#71717A",       // placeholder / tertiary text
          panel: "#121212",       // Level 1 — sidebar, cards
          "panel-2": "#1A1A1A",   // Level 2 — popovers, modals, focused inputs
          "panel-3": "#211E27",   // Level 3 — interactive surfaces (chips)
          edge: "#1F1F1F",        // 1px borders between surfaces
          "edge-bright": "#2A2A2A", // floating-element borders
          // Violet accent palette
          violet: "#8B5CF6",      // primary
          "violet-hover": "#7C3AED",
          "violet-soft": "#D0BCFF", // dim / inverse-primary
          // Status palette (slightly desaturated to match Calm Tech)
          ok: "#10B981",
          warn: "#F59E0B",
          err: "#EF4444",
        },
      },
      fontFamily: {
        // Geometric sans for everything UI.
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Monospace specifically for timestamps, IDs, license keys
        // — anything where digit alignment matters.
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Display + heading scale per design tokens.
        "display-lg": ["32px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        "heading-md": ["20px", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "500" }],
        "label-xs":   ["12px", { lineHeight: "1.2", letterSpacing: "0.06em", fontWeight: "500" }],
      },
      borderRadius: {
        // Soft, disciplined corners — never bubbly.
        "baru-sm": "4px",
        "baru-md": "6px",
        "baru-lg": "8px",
        "baru-xl": "12px",
      },
      boxShadow: {
        // Subtle violet glow for primary CTAs (instead of physical lift).
        "violet-glow": "0 0 0 1px rgba(139,92,246,0.15), 0 8px 24px -8px rgba(139,92,246,0.35)",
        // Floating modal/popover.
        "panel-float": "0 12px 32px -8px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
