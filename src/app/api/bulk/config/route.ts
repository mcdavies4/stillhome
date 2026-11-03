import { NextResponse } from "next/server";
import { bulkEnabled } from "@/lib/bulk";
import { BULK_FIRST_CAP, BULK_MAX_EACH, BULK_MAX_RECIPIENTS, BULK_MAX_TOTAL, BULK_MIN_EACH, bulkFeeSettings } from "@/lib/bulk-shared";

export const dynamic = "force-dynamic";

// What the Android app needs to show the same limits and fee as the website. Nothing secret.
export async function GET() {
  return NextResponse.json({
    enabled: bulkEnabled(),
    minEach: BULK_MIN_EACH,
    maxEach: BULK_MAX_EACH,
    maxRecipients: BULK_MAX_RECIPIENTS,
    maxTotal: BULK_MAX_TOTAL,
    firstCap: BULK_FIRST_CAP,
    fee: bulkFeeSettings(),
  });
}
