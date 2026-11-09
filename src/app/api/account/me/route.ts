import { NextResponse } from "next/server";
import { accountOrders, listSaved, readSession } from "@/lib/account";

export const dynamic = "force-dynamic";

// The signed-in customer's email, recent orders and saved meters. 401 when not signed in.
export async function GET(req: Request) {
  const email = readSession(req.headers.get("cookie"));
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const [orders, saved] = await Promise.all([accountOrders(email).catch(() => []), listSaved(email).catch(() => [])]);
  return NextResponse.json({ email, orders, saved }, { headers: { "Cache-Control": "no-store" } });
}
