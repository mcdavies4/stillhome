// Upcoming charges for the household board. Pure functions, safe in server and client code.
export type BoardPlan = { id: string; biller_name: string; identifier: string; amount_ngn: number; status: string; next_run_on: string | null };

const lagosYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Active plans sorted by next charge date, with the total due in the next 30 days (Lagos dates). */
export function upcomingBoard<T extends BoardPlan>(plans: T[], now: Date = new Date()) {
  const today = lagosYmd(now);
  const limit = lagosYmd(new Date(now.getTime() + 30 * 86_400_000));
  const rows = plans
    .filter((p) => p.status === "active" && p.next_run_on)
    .sort((a, b) => (a.next_run_on! < b.next_run_on! ? -1 : a.next_run_on! > b.next_run_on! ? 1 : 0));
  const due30 = rows.filter((p) => p.next_run_on! >= today && p.next_run_on! <= limit);
  return { rows, due30, total30: due30.reduce((s, p) => s + Number(p.amount_ngn), 0) };
}
