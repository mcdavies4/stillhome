import { buildRow, overLimit } from "@/lib/analytics";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const done = () => new Response(null, { status: 204 });

// The visit counter. It always answers 204 and never tells the browser what it did.
// It ignores: browsers that ask not to be tracked, bots, other websites, preview deployments, and floods.
export async function POST(req: Request) {
  try {
    const h = req.headers;
    if (h.get("dnt") === "1" || h.get("sec-gpc") === "1") return done();
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && process.env.ANALYTICS_ALL !== "1") return done();
    const origin = h.get("origin"), host = h.get("host");
    if (origin && host) { try { if (new URL(origin).host !== host) return done(); } catch { return done(); } }

    const raw = await req.text();
    if (!raw || raw.length > 2000) return done();
    let body: any; try { body = JSON.parse(raw); } catch { return done(); }

    const row = buildRow(req, body);
    if (!row) return done();
    if (overLimit(row.vid)) return done();
    const { error } = await supabaseAdmin().from("site_events").insert(row);
    if (error) console.error("[hit] insert failed (has migration 0024_site_events.sql been run?)", error.message);
  } catch (e) {
    console.error("[hit] failed", e);
  }
  return done();
}
