"use client";

import { useEffect, useState } from "react";
import { isNight, THEME_KEY } from "@/lib/theme-time";

type Mode = "auto" | "light" | "dark";

function readMode(): Mode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function paint(mode: Mode): boolean {
  const dark = mode === "dark" || (mode === "auto" && isNight());
  document.documentElement.classList.toggle("dark", dark);
  return dark;
}

// One button flips light / dark (and remembers it). A second small button appears only while a manual
// choice is set, and puts the site back on automatic day / night.
export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const m = readMode();
    setMode(m);
    setDark(paint(m));
  }, []);

  // While on automatic, switch by itself when the clock passes 6 am / 6 pm, even if the tab stays open.
  useEffect(() => {
    if (mode !== "auto") return;
    const tick = () => setDark(paint("auto"));
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [mode]);

  function flip() {
    const next: Mode = dark ? "light" : "dark";
    setMode(next);
    setDark(paint(next));
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  function backToAuto() {
    setMode("auto");
    setDark(paint("auto"));
    try { localStorage.removeItem(THEME_KEY); } catch {}
  }

  const btn = "w-10 h-10 rounded-xl text-haze hover:text-paper hover:bg-sunk flex items-center justify-center";
  return (
    <>
      <button onClick={flip} className={btn}
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
        title={mode === "auto" ? (dark ? "Night theme (automatic). Tap for light" : "Day theme (automatic). Tap for dark") : undefined}>
        {dark ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
      {mode !== "auto" && (
        <button onClick={backToAuto} className={btn} aria-label="Use automatic day and night theme" title="Automatic day / night">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </button>
      )}
    </>
  );
}
