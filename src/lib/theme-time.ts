// Day / night theme by the visitor's own clock.
// Dark from NIGHT_FROM:00 to NIGHT_TO:00 (local time on their device), light the rest of the day.
// A visitor who picks a theme by hand keeps it (stored as "nolgic-theme" = "light" | "dark");
// with nothing stored the site follows the clock.

export const THEME_KEY = "nolgic-theme";
export const NIGHT_FROM = 18; // 6 pm
export const NIGHT_TO = 6; // 6 am

export function isNight(d: Date = new Date()): boolean {
  const h = d.getHours();
  return h >= NIGHT_FROM || h < NIGHT_TO;
}

// Runs in <head> before the page paints, so there is no flash of the wrong theme.
export const themeInitScript = `
(function(){
  var night = function(){ var h = new Date().getHours(); return h >= ${NIGHT_FROM} || h < ${NIGHT_TO}; };
  var t = null;
  try { t = localStorage.getItem("${THEME_KEY}"); } catch (e) {}
  var dark = t === "dark" || (t !== "light" && night());
  if (dark) document.documentElement.classList.add("dark");
})();
`;
