import { NextResponse } from "next/server";
import { pbExamCatalogue, paybetaConfigured } from "@/lib/paybeta";
import { activeProvider } from "@/lib/bills";
import { examFeeSettings, examMaxOrder, examService } from "@/lib/exams-shared";

export const dynamic = "force-dynamic";

// The exam products the page can sell, with Paybeta's own prices. Empty (and enabled:false) until the switches are on.
export async function GET() {
  const enabled = process.env.EXAMS_ENABLED === "1" && process.env.NEXT_PUBLIC_EXAMS_ENABLED === "1";
  const fee = examFeeSettings();
  const base = { enabled, fee, maxOrder: examMaxOrder(), groups: [] as unknown[] };
  if (!enabled) return NextResponse.json(base);
  if (activeProvider() !== "paybeta" || !paybetaConfigured()) return NextResponse.json({ ...base, enabled: false });

  try {
    const items = await pbExamCatalogue();
    const by = new Map<string, { service: string; title: string; idLabel: string; idHint: string; items: { code: string; name: string; price: number }[] }>();
    for (const i of items) {
      if (i.price > examMaxOrder()) continue;
      const s = examService(i.service, i.serviceName);
      if (!by.has(i.service)) by.set(i.service, { service: i.service, title: s.title, idLabel: s.idLabel, idHint: s.idHint, items: [] });
      by.get(i.service)!.items.push({ code: i.code, name: i.name, price: i.price });
    }
    return NextResponse.json({ ...base, groups: Array.from(by.values()) });
  } catch (e) {
    console.error("[exams] catalogue failed", (e as any)?.message ?? e);
    return NextResponse.json({ ...base, unavailable: true });
  }
}
