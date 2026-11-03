import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Btn, Card, Chip, Field, Icon, Logo, Picker } from "../components/ui";
import { ApiError, BillerItem, checkout, Config, DEFAULT_CONFIG, getBillers, getBulkConfig, getConfig, getRecent, RecentNotice, validate } from "../lib/api";
import { isNoValidate, itemKey, naira, niceName, QUICK_AMOUNTS, serviceFee, TABS, TabKey } from "../lib/catalogue";
import { addOrder, loadEmail, saveEmail } from "../lib/storage";
import { font, nextThemeMode, setThemeMode, useTheme, useThemeMode } from "../lib/theme";

export default function Home() {
  const t = useTheme();
  const themeMode = useThemeMode();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [items, setItems] = useState<BillerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("electricity");
  const [provider, setProvider] = useState("");
  const [item, setItem] = useState<BillerItem | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amountText, setAmountText] = useState("");
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState<{ name: string | null } | null>(null);
  const [busy, setBusy] = useState<"verify" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentNotice[]>([]);
  const [recentAt, setRecentAt] = useState(0);
  const [bulkOn, setBulkOn] = useState(false);

  async function load() {
    setLoading(true); setLoadErr(null);
    try {
      const [cfg, list] = await Promise.all([getConfig().catch(() => DEFAULT_CONFIG), getBillers()]);
      setConfig(cfg); setItems(list);
    } catch (e: any) {
      setLoadErr(e instanceof ApiError ? e.message : "Couldn’t load the list of providers.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); loadEmail().then((e) => e && setEmail(e)); }, []);
  // "Someone bought ..." line, from real delivered orders only. Shows nothing if the list is empty or fails.
  useEffect(() => { getRecent().then(setRecent).catch(() => {}); }, []);
  // Bulk airtime button only shows once the server says bulk is switched on.
  useEffect(() => { getBulkConfig().then((c) => setBulkOn(!!c.enabled)).catch(() => {}); }, []);
  useEffect(() => {
    if (recent.length < 2) return;
    const id = setInterval(() => setRecentAt((n) => n + 1), 6000);
    return () => clearInterval(id);
  }, [recent]);

  const tabDef = TABS.find((x) => x.key === tab)!;
  const providers = useMemo(() => {
    const m = new Map<string, BillerItem[]>();
    for (const i of items.filter(tabDef.match as (b: BillerItem) => boolean)) {
      const a = m.get(i.biller_name); if (a) a.push(i); else m.set(i.biller_name, [i]);
    }
    return Array.from(m.entries()).sort((a, b) => niceName(a[0]).localeCompare(niceName(b[0])));
  }, [items, tabDef]);
  const plans = useMemo(() => {
    const g = providers.find(([n]) => n === provider)?.[1] ?? [];
    return g.every((i) => i.amount > 0) ? [...g].sort((a, b) => a.amount - b.amount) : g;
  }, [providers, provider]);

  const fixed = !!item && item.amount > 0;
  const billAmount = fixed ? item!.amount : Number(amountText || 0);
  const fee = billAmount > 0 ? serviceFee(billAmount, config, item) : 0;
  const total = billAmount + fee;
  const belowMin = billAmount > 0 && billAmount < config.minNgn;
  const aboveMax = billAmount > config.maxNgn;
  const stage = !item ? 0 : !verified ? 1 : 2;

  function pickTab(k: TabKey) { setTab(k); setProvider(""); setItem(null); setVerified(null); setError(null); }
  function pickProvider(name: string) {
    setProvider(name); setVerified(null); setError(null);
    const g = providers.find(([n]) => n === name)?.[1] ?? [];
    setItem(g.length === 1 ? g[0] : null);
  }
  function pickPlan(key: string) { setItem(plans.find((i) => itemKey(i) === key) ?? null); setVerified(null); setError(null); }

  async function doVerify() {
    if (!item || !identifier.trim()) return;
    setError(null);
    if (isNoValidate(item)) { setVerified({ name: null }); return; }
    setBusy("verify"); setVerified(null);
    try { setVerified(await validate(item, identifier.trim())); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function doPay() {
    if (!item || !verified) return;
    setBusy("pay"); setError(null);
    try {
      const em = email.trim();
      const r = await checkout({ email: em, item, identifier: identifier.trim(), amount: billAmount, recipientPhone: null });
      await Promise.all([
        saveEmail(em),
        addOrder({ id: r.orderId, biller: niceName(item.biller_name), identifier: identifier.trim(), amount: billAmount, at: Date.now() }),
      ]);
      router.push({ pathname: "/order/[id]", params: { id: r.orderId, payUrl: r.url } });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const canPay = !!verified && emailOk && billAmount > 0 && !belowMin && !aboveMax && !busy;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <Logo />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => setThemeMode(nextThemeMode(themeMode))} accessibilityRole="button"
              accessibilityLabel={`Appearance: ${themeMode === "auto" ? "automatic, follows the time of day" : themeMode}. Tap to change.`}
              style={{ height: 44, width: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: t.sunk }}>
              <Icon name={themeMode === "auto" ? "auto" : themeMode === "light" ? "sun" : "moon"} color={t.text} size={20} />
            </Pressable>
            <Pressable onPress={() => router.push("/orders")} accessibilityRole="button" accessibilityLabel="Recent orders"
              style={{ height: 44, paddingHorizontal: 14, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.sunk }}>
              <Icon name="list" color={t.text} size={18} />
              <Text style={{ fontFamily: font.semi, color: t.text, fontSize: 15 }}>Orders</Text>
            </Pressable>
          </View>
        </View>

        <Text style={{ fontFamily: font.displayXB, fontSize: 32, lineHeight: 34, color: t.text, letterSpacing: -0.8 }}>
          Light, TV, airtime and data, paid in seconds.
        </Text>
        <Text style={{ fontFamily: font.body, fontSize: 16, lineHeight: 24, color: t.haze, marginTop: 10, marginBottom: 20 }}>
          You see the name on the meter or smartcard before any money moves. If delivery fails, you’re refunded.
        </Text>

        {recent.length > 0 && (() => {
          const n = recent[recentAt % recent.length];
          return (
            <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14,
              paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, backgroundColor: t.sunk }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.ok }} />
              <Text style={{ flex: 1, fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: t.haze }}>
                <Text style={{ fontFamily: font.semi, color: t.text }}>{n.text}</Text> · {n.when} · a real Nolgic order
              </Text>
            </View>
          );
        })()}

        {bulkOn && (
          <Pressable onPress={() => router.push("/bulk")} accessibilityRole="button" accessibilityLabel="Bulk airtime: top up many numbers at once"
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14, padding: 16, borderRadius: 18,
              borderWidth: 1, borderColor: t.line, backgroundColor: t.panel, opacity: pressed ? 0.85 : 1 })}>
            <Icon name="phone" color={t.accent} size={24} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.display, fontSize: 17, color: t.text }}>Bulk airtime</Text>
              <Text style={{ fontFamily: font.body, fontSize: 13.5, color: t.haze, marginTop: 2 }}>Top up many numbers with one payment</Text>
            </View>
            <Icon name="chevron" color={t.haze} size={16} />
          </Pressable>
        )}

        <Card>
          {!config.ngnEnabled ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={{ fontFamily: font.display, fontSize: 22, color: t.text, textAlign: "center" }}>Payments open very shortly.</Text>
              <Text style={{ fontFamily: font.body, color: t.haze, textAlign: "center", marginTop: 8 }}>We’re finishing the last checks. Please check back soon.</Text>
            </View>
          ) : (<>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: font.display, fontSize: 20, color: t.text }}>Pay a bill</Text>
              <Text style={{ fontFamily: font.body, fontSize: 12.5, color: t.haze }}>Secure checkout</Text>
            </View>

            {/* progress */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }} accessible accessibilityLabel={`Step ${stage + 1} of 3`}>
              {["Choose bill", "Check recipient", "Pay"].map((l, n) => {
                const done = stage > n, now = stage === n;
                return (
                  <React.Fragment key={l}>
                    <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
                      backgroundColor: done ? t.ok : now ? t.cta : t.sunk }}>
                      {done ? <Icon name="check" color="#fff" size={13} /> :
                        <Text style={{ fontFamily: font.bold, fontSize: 11.5, color: now ? t.onCta : t.haze }}>{n + 1}</Text>}
                    </View>
                    {now && <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: t.text }}>{l}</Text>}
                    {n < 2 && <View style={{ flex: 1, height: 1, backgroundColor: done ? t.ok + "80" : t.line }} />}
                  </React.Fragment>
                );
              })}
            </View>

            {/* category tiles */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
              {TABS.map((x) => {
                const on = tab === x.key;
                return (
                  <Pressable key={x.key} onPress={() => pickTab(x.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flex: 1, height: 72, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 6,
                      borderColor: on ? t.accent : t.line, backgroundColor: on ? t.cta + "26" : "transparent" }}>
                    <Icon name={x.icon} color={on ? t.accent : t.haze} />
                    <Text style={{ fontFamily: font.semi, fontSize: 13, color: on ? t.text : t.haze }}>{x.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {loading && <ActivityIndicator style={{ marginTop: 24 }} color={t.accent} />}
            {loadErr && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontFamily: font.body, color: t.bad, marginBottom: 10 }}>{loadErr}</Text>
                <Btn variant="ghost" label="Try again" onPress={load} />
              </View>
            )}

            {!loading && !loadErr && (<>
              <Picker label={tabDef.title} placeholder={providers.length ? "Select" : "Nothing available here yet"} value={provider}
                options={providers.map(([n]) => ({ value: n, label: niceName(n) }))} onChange={pickProvider} disabled={!providers.length} />
              {provider !== "" && plans.length > 1 && (
                <Picker label={tabDef.plan} placeholder="Select" value={item ? itemKey(item) : ""}
                  options={plans.map((i) => ({ value: itemKey(i), label: i.name, sub: i.amount > 0 ? naira(i.amount) : undefined }))} onChange={pickPlan} />
              )}
            </>)}

            {item && (
              <View style={{ marginTop: 18, paddingTop: 4, borderTopWidth: 1, borderTopColor: t.line }}>
                <Field label={item.label_name || "Account number"} value={identifier} onChangeText={(v) => { setIdentifier(v); setVerified(null); }}
                  placeholder={isNoValidate(item) ? "08031234567" : "04123456789"} keyboardType={isNoValidate(item) ? "phone-pad" : "default"} autoCorrect={false} autoCapitalize="none" />
                {!fixed ? (<>
                  <Field label="Amount (₦)" value={amountText} onChangeText={(v) => setAmountText(v.replace(/[^\d]/g, ""))} placeholder="5000" keyboardType="number-pad" />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {QUICK_AMOUNTS.filter((a) => a >= config.minNgn).map((a) => (
                      <Chip key={a} label={naira(a)} on={Number(amountText) === a} onPress={() => setAmountText(String(a))} />
                    ))}
                  </View>
                </>) : (
                  <Text style={{ fontFamily: font.body, color: t.haze, marginTop: 12 }}>Price for this plan: <Text style={{ fontFamily: font.semi, color: t.text }}>{naira(item.amount)}</Text></Text>
                )}
                {belowMin && <Text style={{ fontFamily: font.body, color: t.bad, marginTop: 10 }}>Naira payments start at {naira(config.minNgn)}. Choose a larger amount or plan.</Text>}
                {aboveMax && <Text style={{ fontFamily: font.body, color: t.bad, marginTop: 10 }}>The most you can pay in one go is {naira(config.maxNgn)}.</Text>}

                <Btn variant="ghost" style={{ marginTop: 16 }} label={isNoValidate(item) ? "Confirm number" : "Check account name"}
                  onPress={doVerify} busy={busy === "verify"} disabled={!identifier.trim()} />

                {verified && (
                  <View accessibilityLiveRegion="polite" style={{ marginTop: 14, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.ok + "55", backgroundColor: t.ok + "1A" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name="check" color={t.ok} size={15} />
                      <Text style={{ fontFamily: font.semi, color: t.ok, fontSize: 14 }}>{verified.name ? "Account found" : "Number confirmed"}</Text>
                    </View>
                    <Text style={{ fontFamily: font.display, fontSize: 21, color: t.text, marginTop: 4 }}>{verified.name ?? identifier}</Text>
                    <Text style={{ fontFamily: font.body, fontSize: 14, color: t.haze, marginTop: 4, lineHeight: 20 }}>
                      Is this who you meant? Once delivered, a token or top-up can’t be taken back.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {verified && (
              <View style={{ marginTop: 18, paddingTop: 4, borderTopWidth: 1, borderTopColor: t.line }}>
                <Field label="Your email (for your receipt)" value={email} onChangeText={setEmail} placeholder="you@example.com"
                  keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
              </View>
            )}

            {error && (
              <View accessibilityRole="alert" style={{ marginTop: 16, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: t.bad + "66", backgroundColor: t.bad + "1A" }}>
                <Text style={{ fontFamily: font.body, color: t.bad, lineHeight: 20 }}>{error}</Text>
              </View>
            )}

            {verified && billAmount > 0 && (
              <View style={{ marginTop: 18, borderTopWidth: 2, borderTopColor: t.line, borderStyle: "dashed", paddingTop: 16 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, color: t.haze }}>{item?.name}</Text>
                  <Text style={{ fontFamily: font.body, color: t.text }}>{naira(billAmount)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ fontFamily: font.body, color: t.haze }}>Service fee</Text>
                  <Text style={{ fontFamily: font.body, color: t.text }}>{naira(fee)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
                  <Text style={{ fontFamily: font.semi, color: t.text, fontSize: 16 }}>Total</Text>
                  <Text style={{ fontFamily: font.display, fontSize: 26, color: t.text }}>{naira(total)}</Text>
                </View>
                <Btn style={{ marginTop: 16 }} label={busy === "pay" ? "Opening secure checkout" : `Pay ${naira(total)}`} onPress={doPay} busy={busy === "pay"} disabled={!canPay} />
                {!emailOk && <Text style={{ fontFamily: font.body, fontSize: 13, color: t.haze, textAlign: "center", marginTop: 10 }}>Enter your email to continue.</Text>}
                <Text style={{ fontFamily: font.body, fontSize: 12.5, color: t.haze, textAlign: "center", marginTop: 10, lineHeight: 18 }}>
                  Pay by card, bank transfer or USSD. If delivery fails, you’re refunded automatically.
                </Text>
              </View>
            )}
          </>)}
        </Card>

        <Text style={{ fontFamily: font.body, fontSize: 12.5, color: t.haze, textAlign: "center", marginTop: 20, lineHeight: 18 }}>
          Nolgic sells prepaid digital products (tokens, subscriptions, top-ups). It is not a money transfer service.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
