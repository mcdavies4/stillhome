import { NextResponse } from "next/server";
import { addSavedItems, listSaved, readSession, removeSavedItem, sameOrigin, touchSavedItem } from "@/lib/account";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";

// Saved meters / smartcards / numbers for the signed-in customer.
//   { action: "add", items: [...] }   add or rename (also used to copy this device's saved list on sign-in)
//   { action: "remove", id }          delete one
//   { action: "touch", id }           moves a used one to the front
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request" }, { status: 403 });
  const email = readSession(req.headers.get("cookie"));
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  try {
    if (b?.action === "add" && Array.isArray(b.items)) {
      const r = await addSavedItems(email, b.items);
      return NextResponse.json({ ok: true, ...r, saved: await listSaved(email) });
    }
    if ((b?.action === "remove" || b?.action === "touch") && typeof b.id === "string" && UUID_RE.test(b.id)) {
      if (b.action === "remove") await removeSavedItem(email, b.id); else await touchSavedItem(email, b.id);
      return NextResponse.json({ ok: true });
    }
  } catch (e) { console.error("[account/saved]", (e as any)?.message ?? e); return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 }); }
  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}
