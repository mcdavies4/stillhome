import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const light = {
  bg: "#F6F7FA", panel: "#FFFFFF", sunk: "#EEF0F6", line: "#E0E3ED",
  text: "#12172E", haze: "#585F78", accent: "#A05C00",
  cta: "#FFB627", onCta: "#1A1F36", ok: "#087C58", bad: "#C51E1E",
  statusBar: "dark" as const,
};
export const dark: typeof light = {
  bg: "#0B1026", panel: "#141A38", sunk: "#0F152F", line: "#262F58",
  text: "#F5F2E9", haze: "#9AA3C7", accent: "#FFB627",
  cta: "#FFB627", onCta: "#0B1026", ok: "#3DDC97", bad: "#FF6B6B",
  statusBar: "light" as any,
};
export type Theme = typeof light;

// Day or night follows the phone's local clock (dark from 18:00 to 06:00). The person can override it
// with the sun/moon button; tapping through "Auto" goes back to following the clock. The choice is remembered.
export type ThemeMode = "auto" | "light" | "dark";
const KEY = "nolgic.theme.v1";
export const isNight = (d: Date = new Date()) => d.getHours() >= 18 || d.getHours() < 6;

let mode: ThemeMode = "auto";
let tick = 0; // bumps every minute so "auto" flips at 18:00 / 06:00 while the app is open
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

AsyncStorage.getItem(KEY).then((v) => {
  if (v === "light" || v === "dark" || v === "auto") { mode = v; emit(); }
}).catch(() => {});

export function setThemeMode(m: ThemeMode) {
  mode = m; emit();
  AsyncStorage.setItem(KEY, m).catch(() => {});
}
export const nextThemeMode = (m: ThemeMode): ThemeMode => (m === "auto" ? "light" : m === "light" ? "dark" : "auto");

const snapshot = () => `${mode}|${isNight() ? "n" : "d"}|${tick}`;

/** Current choice (auto/light/dark) for the toggle button. */
export function useThemeMode(): ThemeMode {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return mode;
}

export const useTheme = (): Theme => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    const id = setInterval(() => { tick += 1; emit(); }, 60_000);
    return () => clearInterval(id);
  }, []);
  const night = mode === "auto" ? isNight() : mode === "dark";
  return night ? dark : light;
};

export const font = {
  display: "BricolageGrotesque_700Bold",
  displayXB: "BricolageGrotesque_800ExtraBold",
  body: "InstrumentSans_400Regular",
  medium: "InstrumentSans_500Medium",
  semi: "InstrumentSans_600SemiBold",
  bold: "InstrumentSans_700Bold",
};
