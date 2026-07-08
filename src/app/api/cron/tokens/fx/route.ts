import { NextResponse } from "next/server";
import { alertFounder } from "@/lib/alerts";

// Daily FX margin guard.
// Fetches the live GBP->NGN mid-market rate and compares it with the
// customer rate (NGN_PER_GBP). If the implied margin drops below
// FX_MIN_MARGIN_PCT (default 3%), or the customer rate exceeds mid-market
// (guaranteed loss), it emails the founder with a suggested new rate.
//
// Note: mid-market is a proxy — the true benchmark is your wallet
// acquisition rate, which is typically slightly worse than mid-market.
// Keep FX_MIN_MARGIN_PCT accordingly (3-5%).

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerRate = Number(process.env.NGN_PER_GBP ?? "0");
  if (!customerRate) {
    return NextResponse.json({ error: "NGN_PER_GBP not set" }, { status: 500 });
  }

  let mid: number | null = null;
  try {
    // Keyless, free endpoint; NGN included in the rates map.
    const res = await fetch("https://open.er-api.com/v6/latest/GBP", { cache: "no-store" });
    const body = await res.json();
    mid = Number(body?.rates?.NGN) || null;
  } catch (e) {
    console.error("[fx-cron] rate fetch failed", e);
  }

  if (!mid) {
    await alertFounder(
      "FX check could not run",
      "The daily FX rate fetch failed — check your NGN_PER_GBP against the market manually today."
    );
    return NextResponse.json({ ok: false, reason: "rate fetch failed" });
  }

  const marginPct = ((mid - customerRate) / mid) * 100;
  const minMargin = Number(process.env.FX_MIN_MARGIN_PCT ?? "3");
  const suggested = Math.floor((mid * (1 - (minMargin + 1) / 100)) / 5) * 5; // ~min+1% margin, rounded to 5

  if (customerRate >= mid) {
    await alertFounder(
      "🚨 FX: you are selling BELOW cost",
      `Mid-market GBP→NGN: ₦${mid.toFixed(0)}\nYour customer rate (NGN_PER_GBP): ₦${customerRate}\n\nEvery order is losing money. Update NGN_PER_GBP in Vercel NOW — suggested: ₦${suggested}.`
    );
  } else if (marginPct < minMargin) {
    await alertFounder(
      `FX margin thin: ${marginPct.toFixed(1)}%`,
      `Mid-market GBP→NGN: ₦${mid.toFixed(0)}\nYour customer rate: ₦${customerRate}\nImplied margin vs mid-market: ${marginPct.toFixed(1)}% (threshold ${minMargin}%)\n\nSuggested NGN_PER_GBP: ₦${suggested}\nRemember: your true wallet acquisition rate is usually a little worse than mid-market.`
    );
  }

  return NextResponse.json({
    ok: true,
    mid,
    customerRate,
    marginPct: Number(marginPct.toFixed(2)),
    alerted: customerRate >= mid || marginPct < minMargin,
  });
}
