import { NextResponse } from "next/server";
import { ngnFeeSettings, feeSettingsFor, ngnMaxOrder } from "@/lib/ngn-fee";
import { getCountry } from "@/lib/countries";

// Public, non-secret checkout settings. The Nolgic mobile app reads this so the fee and the
// min/max it shows always match what the server charges (change the env vars, redeploy, done).
export async function GET() {
  const ng = getCountry("NG");
  return NextResponse.json({
    ngnEnabled: process.env.NEXT_PUBLIC_NGN_PAY_ENABLED === "1",
    fee: ngnFeeSettings(),
    fees: { airtime_data: feeSettingsFor("airtime_data"), tv: feeSettingsFor("tv"), electricity: feeSettingsFor("electricity") },
    minNgn: ng.minDomestic ?? ng.minLocal,
    maxNgn: ngnMaxOrder(ng.maxLocal),
  });
}
