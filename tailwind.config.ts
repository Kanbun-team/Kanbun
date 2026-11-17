import type { Config } from "tailwindcss";

// Semantic color keys backed by the CSS tokens in src/app/globals.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        surface: token("surface"),
        raised: token("raised"),
        ink: { DEFAULT: token("ink"), muted: token("ink-muted") },
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          soft: token("accent-soft"),
          fg: token("on-accent"),
        },
        danger: token("danger"),
        warning: token("warning"),
        success: token("success"),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.125rem" }],
        base: ["0.875rem", { lineHeight: "1.25rem" }],
        md: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.25rem", { lineHeight: "1.75rem" }],
        xl: ["1.5rem", { lineHeight: "2rem" }],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        float: "var(--shadow-float)",
      },
      borderRadius: {
        control: "6px",
        card: "8px",
        panel: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
