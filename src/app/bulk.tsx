import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Btn, Card, Chip, Field } from "../components/ui";
import { bulkCheckout, BulkConfig, DEFAULT_BULK, getBulkConfig } from "../lib/api";
import { batchFee, checkRows, DraftRow, NETWORKS, localPhone, parseBulkText } from "../lib/bulk";
import { naira } from "../lib/catalogue";
import { addOrder, loadEmail, saveEmail } from "../lib/storage";
import { font, useTheme } from "../lib/theme";

export default function Bulk() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<BulkConfig>(DEFAULT_BULK);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [paste, setPaste] = useState("");
  const [defAmount, setDefAmount] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBulkConfig().then((c) => setCfg(c)).catch(() => {}).finally(() => setCfgLoaded(true));
    loadEmail().then((e) => e && setEmail(e));
  }, []);

  const checked = useMemo(() => checkRows(rows, cfg), [rows, cfg]);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const fee = rows.length ? batchFee(total, cfg) : 0;
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  function add() {
    const { rows: add, skipped } = parseBulkText(paste, Math.round(Number(defAmount)) || 0);
    const msgs: string[] = [];
    if (skipped.length) msgs.push(`Skipped ${skipped.length} line${skipped.length > 1 ? "s" : ""} that don’t look like a Nigerian mobile number: ${skipped.slice(0, 3).join(" · ")}${skipped.length > 3 ? " …" : ""}`);
    if (rows.length + add.length > cfg.maxRecipients) msgs.push(`Only the first ${cfg.maxRecipients} numbers were kept.`);
    setNotes(msgs);
    if (!add.length) return;
    setRows((cur) => [...cur, ...add].slice(0, cfg.maxRecipients));
    setPaste("");
  }
  const patch = (i: number, p: Partial<DraftRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function pay() {
    setError(null);
    if (!checked.ok) { setError(checked.error); return; }
    if (!emailOk) { setError("Enter your email so we can send the receipt."); return; }
    setBusy(true);
    try {
      const em = email.trim();
      const r = await bulkCheckout(em, checked.rows);
      await Promise.all([
        saveEmail(em),
        addOrder({ id: r.bulkId, biller: `Bulk airtime · ${checked.rows.length} numbers`, identifier: "Several numbers", amount: checked.total, at: Date.now(), kind: "bulk" }),
      ]);
      router.push({ pathname: "/bulk/[id]", params: { id: r.bulkId, payUrl: r.url } });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  const input = { height: 46, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.sunk, paddingHorizontal: 12, fontSize: 16, color: t.text, fontFamily: font.body } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.displayXB, fontSize: 30, color: t.text, letterSpacing: -0.6 }}>Bulk airtime</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 14, justifyContent: "center" }}>
            <Text style={{ fontFamily: font.semi, color: t.accent, fontSize: 16 }}>Close</Text>
          </Pressable>
        </View>
        <Text style={{ fontFamily: font.body, fontSize: 16, lineHeight: 24, color: t.haze, marginBottom: 18 }}>
          Top up many phones with one payment. Any number that fails is refunded automatically, and you see the result for every number.
        </Text>

        {cfgLoaded && !cfg.enabled && (
          <Card style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: font.display, fontSize: 18, color: t.text }}>Bulk airtime is opening soon</Text>
            <Text style={{ fontFamily: font.body, color: t.haze, marginTop: 6, lineHeight: 22 }}>It isn’t switched on yet. Check back shortly.</Text>
          </Card>
        )}

        <Card>
          <Text style={{ fontFamily: font.display, fontSize: 18, color: t.text }}>Add numbers</Text>
          <Text style={{ fontFamily: font.body, fontSize: 14, lineHeight: 21, color: t.haze, marginTop: 6 }}>
            One per line with the amount after it, like 08031234567 500. Add a network at the end (mtn, glo, airtel, 9mobile) if you know it. Otherwise we guess from the number and you can change it below.
          </Text>
          <TextInput value={paste} onChangeText={setPaste} multiline placeholder={"08031234567 500\n08051234568 1000 glo"} placeholderTextColor={t.haze + "99"}
            autoCorrect={false} style={{ ...input, height: 120, marginTop: 12, paddingTop: 12, textAlignVertical: "top" }} accessibilityLabel="Numbers" />
          <Field label="Amount for lines without one" value={defAmount} onChangeText={(v) => setDefAmount(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="e.g. 500" />
          <Btn style={{ marginTop: 14 }} label="Add to list" onPress={add} disabled={!paste.trim()} />
          {notes.map((n, i) => <Text key={i} style={{ fontFamily: font.body, fontSize: 13.5, color: t.accent, marginTop: 10 }}>{n}</Text>)}
        </Card>

        {rows.length > 0 && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 22, marginBottom: 8 }}>
              <Text style={{ fontFamily: font.display, fontSize: 18, color: t.text }}>Your list ({rows.length})</Text>
              <Pressable onPress={() => setRows([])} accessibilityRole="button" style={{ height: 40, justifyContent: "center" }}>
                <Text style={{ fontFamily: font.semi, color: t.haze, fontSize: 14 }}>Clear all</Text>
              </Pressable>
            </View>
            {rows.map((r, i) => (
              <View key={i} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.line }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput value={r.phone} onChangeText={(v) => patch(i, { phone: v })} keyboardType="phone-pad" accessibilityLabel={`Phone number ${i + 1}`}
                    style={{ ...input, flex: 1.4, borderColor: localPhone(r.phone) ? t.line : t.bad }} />
                  <TextInput value={r.amount ? String(r.amount) : ""} onChangeText={(v) => patch(i, { amount: Number(v.replace(/\D/g, "")) })} keyboardType="number-pad"
                    placeholder="₦" placeholderTextColor={t.haze + "99"} accessibilityLabel={`Amount for number ${i + 1}`} style={{ ...input, flex: 1 }} />
                  <Pressable onPress={() => setRows((c) => c.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove number ${i + 1}`}
                    style={{ width: 44, height: 46, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: t.haze, fontSize: 24, lineHeight: 26 }}>×</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {NETWORKS.map((n) => <Chip key={n.code} label={n.label} on={r.network === n.code} onPress={() => patch(i, { network: n.code })} />)}
                </View>
                {!r.network && <Text style={{ fontFamily: font.body, fontSize: 12.5, color: t.bad, marginTop: 6 }}>Choose a network</Text>}
              </View>
            ))}

            <Card style={{ marginTop: 14, backgroundColor: t.sunk }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: font.body, color: t.haze, fontSize: 15 }}>Airtime ({rows.length} numbers)</Text>
                <Text style={{ fontFamily: font.medium, color: t.text, fontSize: 15 }}>{naira(total)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ fontFamily: font.body, color: t.haze, fontSize: 15 }}>Service fee</Text>
                <Text style={{ fontFamily: font.medium, color: t.text, fontSize: 15 }}>{naira(fee)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line }}>
                <Text style={{ fontFamily: font.semi, color: t.text, fontSize: 16 }}>You pay</Text>
                <Text style={{ fontFamily: font.display, color: t.text, fontSize: 24 }}>{naira(total + fee)}</Text>
              </View>
            </Card>

            <Field label="Your email (for your receipt)" value={email} onChangeText={setEmail} placeholder="you@example.com"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
            {error && <Text accessibilityRole="alert" style={{ fontFamily: font.medium, color: t.bad, marginTop: 12 }}>{error}</Text>}
            <Btn style={{ marginTop: 16 }} label={`Pay ${naira(total + fee)}`} busy={busy} disabled={!cfg.enabled || !emailOk} onPress={pay} />
            <Text style={{ fontFamily: font.body, fontSize: 13, lineHeight: 20, color: t.haze, marginTop: 12 }}>
              Limits: {naira(cfg.minEach)} to {naira(cfg.maxEach)} per number, up to {cfg.maxRecipients} numbers and {naira(cfg.maxTotal)} per batch. Your first batch can be up to {naira(cfg.firstCap)}. Check the network for each number, because a number on a different network may fail.
            </Text>
          </>
        )}
        {!rows.length && error && <Text accessibilityRole="alert" style={{ fontFamily: font.medium, color: t.bad, marginTop: 12 }}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
