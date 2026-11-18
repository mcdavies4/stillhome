import { upcomingBoard, type BoardPlan } from "@/lib/upcoming";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const day = (ymd: string) =>
  new Date(`${ymd}T12:00:00+01:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

// Household board: every upcoming monthly charge across one payer's bills, with the total due in the next 30 days.
export default function UpcomingBoard({ plans }: { plans: BoardPlan[] }) {
  const b = upcomingBoard(plans);
  if (b.rows.length === 0) return null;
  const n = b.due30.length;
  return (
    <section className="mt-10 rounded-2xl bg-white text-[#0B1026] border border-[#e3e6ee] p-5" aria-labelledby="upcoming-charges">
      <h2 id="upcoming-charges" className="font-display font-bold text-xl">Next charges</h2>
      <p className="mt-2 text-[#4b5266]">
        {n > 0
          ? `${naira(b.total30)} across ${n} ${n === 1 ? "bill" : "bills"} in the next 30 days, plus service fees.`
          : "Nothing due in the next 30 days."}
      </p>
      <ul className="mt-3 divide-y divide-[#e3e6ee] border-y border-[#e3e6ee]">
        {b.rows.map((p) => (
          <li key={p.id} className="py-2 flex justify-between gap-3 text-sm">
            <span>{day(p.next_run_on!)} · {p.biller_name} {p.identifier}</span>
            <span className="font-semibold whitespace-nowrap">{naira(p.amount_ngn)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
