// Finds fulfilled buyers (emails) placed within an optional UTC date range. Test orders and example.com are excluded.
import { supabaseAdmin } from "@/lib/supabase";

const PAGE = 1000;

type Row = { email: string | null; status: string; created_at: string; is_test?: boolean };

async function fetchAllOrders(): Promise<Row[]> {
  const db = supabaseAdmin();
  const out: Row[] = [];
  let withTest = true;
  for (let from = 0; ; from += PAGE) {
    const cols = withTest ? "email,status,created_at,is_test" : "email,status,created_at";
    const { data, error } = await db.from("orders").select(cols as any).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error && withTest && /is_test/.test(error.message ?? "")) { withTest = false; from -= PAGE; continue; }
    if (error) throw new Error("orders query failed");
    const rows = ((data ?? []) as unknown) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function buyerEmails(from: string | null, to: string | null): Promise<string[]> {
  const set = new Set<string>();
  for (const o of await fetchAllOrders()) {
    if (o.is_test || o.status !== "fulfilled") continue;
    const day = (o.created_at ?? "").slice(0, 10);
    if (from && day < from) continue;
    if (to && day > to) continue;
    const email = (o.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || email.endsWith("@example.com") || email === "test@example.com") continue;
    set.add(email);
  }
  return Array.from(set);
}
