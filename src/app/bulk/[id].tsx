import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Btn, Card, Icon } from "../../components/ui";
import { BulkView, getBulk } from "../../lib/api";
import { naira } from "../../lib/catalogue";
import { font, useTheme } from "../../lib/theme";

type Tone = "wait" | "work" | "ok" | "bad" | "check";
const NET: Record<string, string> = { mtn: "MTN", glo: "Glo", airtel: "Airtel", "9mobile": "9mobile" };
const FINAL = ["settled", "refund_failed", "expired"];

function headline(v: BulkView): { title: string; body: string; tone: Tone } {
  switch (v.status) {
    case "pending_payment": return { title: "Waiting for payment", body: "Finish paying in the secure checkout. This page updates by itself.", tone: "wait" };
    case "paid": case "processing": case "settling":
      return { title: "Sending your airtime", body: "Each number is being topped up. This usually takes a minute or two. You can leave this screen; we email you the result.", tone: "work" };
    case "settled":
      if (v.failed === 0) return { title: "All delivered", body: `Airtime has been sent to all ${v.count} numbers.`, tone: "ok" };
      if (v.delivered === 0) return { title: "Nothing could be delivered. You’ve been refunded", body: "The provider didn’t complete any of these numbers, so we’ve refunded your whole payment, fee included. It can take a few working days to show.", tone: "bad" };
      return { title: `${v.delivered} of ${v.count} delivered`, body: `${v.failed} number${v.failed > 1 ? "s" : ""} didn’t go through. We’ve refunded ${naira(v.refunded_ngn)} for ${v.failed > 1 ? "them" : "it"}. It can take a few working days to show.`, tone: "ok" };
    case "needs_review": return { title: "Payment received. We’re checking your batch", body: "The provider hasn’t given us a final answer yet, so we’re checking it by hand. Every number will either be delivered or refunded. Your money is safe.", tone: "check" };
    case "refund_failed": return { title: "We need to fix something", body: "Some numbers failed and the automatic refund didn’t go through. We’ve been alerted. Email nolgichq@gmail.com with your batch number and we’ll sort it out straight away.", tone: "bad" };
    default: return { title: "This batch expired", body: "No payment was taken. You can start a new batch any time.", tone: "wait" };
  }
}

export default function BulkStatus() {
  const { id, payUrl } = useLocalSearchParams<{ id: string; payUrl?: string }>();
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [v, setV] = useState<BulkView | null>(null);
  const [offline, setOffline] = useState(false);
  const opened = useRef(false);
  const polls = useRef(0);

  const refresh = useCallback(async () => {
    try { setV(await getBulk(String(id))); setOffline(false); } catch { setOffline(true); }
  }, [id]);

  useEffect(() => {
    if (!payUrl || opened.current) return;
    opened.current = true;
    (async () => { try { await WebBrowser.openBrowserAsync(String(payUrl), { createTask: false }); } catch {} refresh(); })();
  }, [payUrl, refresh]);

  useEffect(() => {
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (stop) return;
      polls.current += 1;
      timer = setTimeout(tick, polls.current < 60 ? 4000 : 20000);
    };
    tick();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { stop = true; clearTimeout(timer); sub.remove(); };
  }, [refresh]);

  // Stop the quick polling once the batch is finished.
  useEffect(() => { if (v && FINAL.includes(v.status)) polls.current = 1000; }, [v]);

  if (!v) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 40, paddingHorizontal: 20 }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: t.text }}>{offline ? "Can’t reach Nolgic" : "Loading your batch…"}</Text>
        {offline && <Btn style={{ marginTop: 20 }} label="Try again" onPress={refresh} />}
      </View>
    );
  }

  const h = headline(v);
  const done = v.delivered + v.failed;
  const pct = v.count ? Math.round((done / v.count) * 100) : 0;
  const paid = v.status !== "pending_payment" && v.status !== "expired";
  const settled = v.status === "settled";
  const paidNet = v.amount_total + v.service_fee - v.refunded_ngn;
  const iconName = h.tone === "ok" ? "check" : h.tone === "bad" ? "alert" : h.tone === "check" ? "search" : "clock";
  const color = h.tone === "ok" ? t.ok : h.tone === "bad" ? t.bad : t.accent;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }} style={{ backgroundColor: t.bg }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color + "26", alignItems: "center", justifyContent: "center" }}>
        <Icon name={iconName} color={color} size={28} />
      </View>
      <Text accessibilityRole="header" style={{ fontFamily: font.displayXB, fontSize: 28, lineHeight: 31, color: t.text, marginTop: 20, letterSpacing: -0.5 }}>{h.title}</Text>
      <Text style={{ fontFamily: font.body, fontSize: 16.5, lineHeight: 25, color: t.haze, marginTop: 10 }}>{h.body}</Text>

      {paid && v.status !== "needs_review" && (
        <View style={{ marginTop: 20 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.sunk, overflow: "hidden" }}>
            <View style={{ height: 8, width: `${pct}%`, backgroundColor: t.cta }} />
          </View>
          <Text style={{ fontFamily: font.body, fontSize: 13.5, color: t.haze, marginTop: 8 }}>{done} of {v.count} finished{v.failed > 0 ? ` · ${v.failed} failed` : ""}</Text>
        </View>
      )}

      <Card style={{ marginTop: 24, padding: 0 }}>
        {v.recipients.map((r, i) => {
          const label = r.status === "delivered" ? "Delivered" : r.status === "failed" ? (settled ? "Refunded" : "Failed") : paid ? "Sending" : "Waiting";
          const c = r.status === "delivered" ? t.ok : r.status === "failed" ? t.bad : t.haze;
          return (
            <View key={r.row} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 18, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 15.5, color: t.text }}>{r.phone}</Text>
                <Text style={{ fontFamily: font.body, fontSize: 13, color: t.haze, marginTop: 2 }}>{NET[r.network] ?? r.network} · {naira(r.amount)}</Text>
              </View>
              <Text style={{ fontFamily: font.semi, fontSize: 13, color: c }}>{label}</Text>
            </View>
          );
        })}
        <View style={{ padding: 18, backgroundColor: t.sunk, borderBottomLeftRadius: 23, borderBottomRightRadius: 23, borderTopWidth: 1, borderTopColor: t.line }}>
          <Row k="Airtime" v={naira(v.amount_total)} />
          <Row k="Service fee" v={naira(v.service_fee)} />
          {v.refunded_ngn > 0 && <Row k="Refunded" v={`−${naira(v.refunded_ngn)}`} good />}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.line }}>
            <Text style={{ fontFamily: font.semi, fontSize: 16, color: t.text }}>{settled ? "You paid" : "Total"}</Text>
            <Text style={{ fontFamily: font.display, fontSize: 22, color: t.text }}>{naira(settled ? paidNet : v.amount_total + v.service_fee)}</Text>
          </View>
        </View>
      </Card>
      <Text style={{ fontFamily: font.body, fontSize: 13.5, color: t.haze, marginTop: 14 }}>Batch number {v.id.slice(0, 8)}</Text>
      {offline && <Text style={{ fontFamily: font.body, fontSize: 13.5, color: t.accent, marginTop: 8 }}>Can’t reach Nolgic right now. Showing the last update.</Text>}
      <Btn style={{ marginTop: 22 }} variant="ghost" label="Back to Nolgic" onPress={() => router.replace("/")} />
    </ScrollView>
  );

  function Row({ k, v: val, good }: { k: string; v: string; good?: boolean }) {
    return (
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        <Text style={{ fontFamily: font.body, fontSize: 15, color: t.haze }}>{k}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 15, color: good ? t.ok : t.text }}>{val}</Text>
      </View>
    );
  }
}
