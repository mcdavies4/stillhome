import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#0B1026",      // NEPA-out darkness
        panel: "#141A38",
        line: "#232B52",
        tungsten: "#FFB627",   // filament glow
        ember: "#FF7A1A",
        haze: "#9AA3C7",
        paper: "#F5F2E9",
        ok: "#3DDC97",
        bad: "#FF5D5D"
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
