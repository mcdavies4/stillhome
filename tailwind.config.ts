import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        night: "rgb(var(--night) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        tungsten: "rgb(var(--tungsten) / <alpha-value>)",
        ember: "rgb(var(--ember) / <alpha-value>)",
        haze: "rgb(var(--haze) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)"
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "sans-serif"],
        body: ["'Instrument Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"]
      },
      boxShadow: {
        glow: "0 0 40px rgba(255,182,39,0.25), 0 0 120px rgba(255,122,26,0.12)"
      }
    }
  },
  plugins: []
};
export default config;
