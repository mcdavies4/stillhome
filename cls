warning: in the working copy of 'src/app/api/checkout/route.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/app/page.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/reconcile.ts', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/src/app/api/checkout/route.ts b/src/app/api/checkout/route.ts[m
[1mindex 7daebd5..2b4da8e 100644[m
[1m--- a/src/app/api/checkout/route.ts[m
[1m+++ b/src/app/api/checkout/route.ts[m
[36m@@ -7,8 +7,12 @@[m [mimport { getCountry, isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/countries[m
 import { rateLimit } from "@/lib/ratelimit";[m
 import { velocityCheck } from "@/lib/velocity";[m
 import { alertFounder } from "@/lib/alerts";[m
[32m+[m[32mimport { initializeTransaction, paystackConfigured } from "@/lib/paystack";[m
 [m
[31m-// Creates the order row + Stripe Checkout session.[m
[32m+[m[32m// Creates the order row + a payment session:[m
[32m+[m[32m//   - default: Stripe Checkout in GBP (diaspora, any supported country)[m
[32m+[m[32m//   - payIn:"ngn" (Nigeria only): Paystack hosted checkout in naira[m
[32m+[m[32m//     (card / bank transfer / USSD). Fee = NG_LOCAL_FEE_NGN (default ₦100).[m
 // Re-validates the identifier server-side where the biller supports it —[m
 // airtime/data have no validation (the phone number IS the account).[m
 export async function POST(req: Request) {[m
[36m@@ -47,6 +51,78 @@[m [mexport async function POST(req: Request) {[m
       if (!noValidate) throw err;[m
     }[m
 [m
[32m+[m[32m    // ---- Naira path (Nigeria domestic, paid via Paystack) -----------------[m
[32m+[m[32m    if (b.payIn === "ngn") {[m
[32m+[m[32m      if (countryCode !== "NG") {[m
[32m+[m[32m        return NextResponse.json({ error: "Naira payment is only available for Nigeria." }, { status: 400 });[m
[32m+[m[32m      }[m
[32m+[m[32m      if (!paystackConfigured()) {[m
[32m+[m[32m        return NextResponse.json({ error: "Naira payments aren't available yet — please check back soon." }, { status: 503 });[m
[32m+[m[32m      }[m
[32m+[m[32m      const amountNgn = Math.round(Number(amountLocal));[m
[32m+[m[32m      if (!Number.isFinite(amountNgn) || amountNgn < country.minLocal || amountNgn > country.maxLocal) {[m
[32m+[m[32m        return NextResponse.json([m
[32m+[m[32m          { error: `Amount must be between ${money(country.minLocal, "NG")} and ${money(country.maxLocal, "NG")}` },[m
[32m+[m[32m          { status: 400 }[m
[32m+[m[32m        );[m
[32m+[m[32m      }[m
[32m+[m[32m      const feeNgn = Math.max(0, Math.round(Number(process.env.NG_LOCAL_FEE_NGN ?? "100")));[m
[32m+[m[32m      const totalNgn = amountNgn + feeNgn;[m
[32m+[m
[32m+[m[32m      // Velocity check works in pence; approximate with the NGN rate (reference only).[m
[32m+[m[32m      const approxPence = Math.round((totalNgn / Number(process.env.NGN_PER_GBP ?? country.fxDefault)) * 100);[m
[32m+[m[32m      const velN = await velocityCheck({ email: b.email, ip, amountGbpPence: approxPence });[m
[32m+[m[32m      if (velN.blocked) {[m
[32m+[m[32m        alertFounder([m
[32m+[m[32m          "Order blocked by velocity check",[m
[32m+[m[32m          `Email: ${b.email}\nIP: ${ip}\nReason: ${velN.reason}\nAmount: ₦${totalNgn.toLocaleString()} · ${b.billerName} · NG (Paystack)`[m
[32m+[m[32m        );[m
[32m+[m[32m        return NextResponse.json([m
[32m+[m[32m          { error: "For your security this order needs review. Please contact nolgichq@gmail.com if you believe this is a mistake." },[m
[32m+[m[32m          { status: 403 }[m
[32m+[m[32m        );[m
[32m+[m[32m      }[m
[32m+[m
[32m+[m[32m      const dbN = supabaseAdmin();[m
[32m+[m[32m      const { data: orderN, error: errN } = await dbN[m
[32m+[m[32m        .from("orders")[m
[32m+[m[32m        .insert({[m
[32m+[m[32m          user_id: b.userId ?? null,[m
[32m+[m[32m          email: b.email,[m
[32m+[m[32m          ip,[m
[32m+[m[32m          country: "NG",[m
[32m+[m[32m          currency: "NGN",[m
[32m+[m[32m          payment_provider: "paystack",[m
[32m+[m[32m          biller_code: b.billerCode,[m
[32m+[m[32m          item_code: b.itemCode,[m
[32m+[m[32m          biller_name: b.billerName,[m
[32m+[m[32m          identifier,[m
[32m+[m[32m          identifier_label: b.identifierLabel,[m
[32m+[m[32m          customer_name: v.name,[m
[32m+[m[32m          recipient_whatsapp: b.recipientWhatsapp ?? null,[m
[32m+[m[32m          amount_ngn: amountNgn,[m
[32m+[m[32m          service_fee_local: feeNgn,[m
[32m+[m[32m          fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? country.fxDefault), // reference only[m
[32m+[m[32m          service_fee_pence: 0,[m
[32m+[m[32m          amount_gbp_pence: 0, // not a GBP order[m
[32m+[m[32m          status: "pending_payment",[m
[32m+[m[32m        })[m
[32m+[m[32m        .select("id")[m
[32m+[m[32m        .single();[m
[32m+[m[32m      if (errN) throw errN;[m
[32m+[m
[32m+[m[32m      const appUrlN = process.env.NEXT_PUBLIC_APP_URL!;[m
[32m+[m[32m      const init = await initializeTransaction({[m
[32m+[m[32m        email: b.email,[m
[32m+[m[32m        amountNgn: totalNgn,[m
[32m+[m[32m        orderId: orderN.id,[m
[32m+[m[32m        callbackUrl: `${appUrlN}/order/${orderN.id}?paid=1`,[m
[32m+[m[32m      });[m
[32m+[m[32m      await dbN.from("orders").update({ paystack_reference: init.reference }).eq("id", orderN.id);[m
[32m+[m
[32m+[m[32m      return NextResponse.json({ url: init.authorizationUrl, orderId: orderN.id, total: `₦${totalNgn.toLocaleString()}` });[m
[32m+[m[32m    }[m
[32m+[m
     const quote = quoteGbp(Number(amountLocal), countryCode);[m
 [m
     // Fraud velocity gate (cashout pattern / first-order cap)[m
[1mdiff --git a/src/app/page.tsx b/src/app/page.tsx[m
[1mindex 01a0609..b952534 100644[m
[1m--- a/src/app/page.tsx[m
[1m+++ b/src/app/page.tsx[m
[36m@@ -15,6 +15,11 @@[m [mtype BillerItem = {[m
   label_name: string;[m
 };[m
 [m
[32m+[m[32m// Naira (Nigeria-domestic) checkout is hidden until Paystack is live:[m
[32m+[m[32m// set NEXT_PUBLIC_NGN_PAY_ENABLED=1 in Vercel to show it.[m
[32m+[m[32mconst NGN_ENABLED = process.env.NEXT_PUBLIC_NGN_PAY_ENABLED === "1";[m
[32m+[m[32mconst NGN_FEE = Number(process.env.NEXT_PUBLIC_NG_LOCAL_FEE_NGN ?? "100");[m
[32m+[m
 const itemKey = (i: BillerItem) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;[m
 [m
 // Country-agnostic category matchers (work for NG discos AND GH's ECG etc.)[m
[36m@@ -37,6 +42,9 @@[m [mconst FAQS = [[m
   { q: "How do I pay a NEPA / electricity bill in Nigeria from the UK?", a: "Pick the DisCo (EKEDC, IKEDC, EEDC and others), enter the meter number, and we show you the registered account name. Pay in pounds by card and the prepaid token is issued in seconds — we show it on screen, email it to you, and can WhatsApp it to your family." },[m
   { q: "Can I pay for DSTV or GOTV from abroad?", a: "Yes. Choose the package, enter the smartcard/IUC number, confirm the account holder's name we look up, and pay by card. The decoder is credited within seconds — no one in Nigeria needs to queue or do anything." },[m
   { q: "How do I buy MTN, Airtel or Glo airtime from the UK?", a: "Select the network, enter the phone number and amount, and pay in pounds. The airtime lands on the phone instantly. Data bundles work the same way." },[m
[32m+[m[32m  ...(NGN_ENABLED ? [[m
[32m+[m[32m  { q: "Can I pay from inside Nigeria, in naira?", a: "Yes. Choose \"Nigeria — pay in ₦\" at the top of the payment form and pay by card, bank transfer or USSD. The token or top-up is delivered in seconds, with the same name-check and automatic refund if delivery fails." },[m
[32m+[m[32m  ] : []),[m
   { q: "Is Nolgic a money transfer service?", a: "No — you're buying a prepaid product (a token, subscription or top-up) at a pound price shown upfront. We deliver the product directly; we never move money to a person." },[m
   { q: "What happens if delivery fails?", a: "Your card is refunded automatically and in full. You can never pay for something that wasn't delivered." },[m
   { q: "What does it cost?", a: "The pound price shown at checkout is everything — product price plus a small service fee. No hidden exchange-rate surprises after the fact." },[m
[36m@@ -50,6 +58,7 @@[m [mconst STEPS = [[m
 [m
 export default function Home() {[m
   const [country, setCountry] = useState<CountryCode>("NG");[m
[32m+[m[32m  const [payIn, setPayIn] = useState<"gbp" | "ngn">("gbp");[m
   const [items, setItems] = useState<BillerItem[]>([]);[m
   const [tab, setTab] = useState("electricity");[m
   const [item, setItem] = useState<BillerItem | null>(null);[m
[36m@@ -62,6 +71,7 @@[m [mexport default function Home() {[m
   const [error, setError] = useState<string | null>(null);[m
 [m
   const cfg = getCountry(country);[m
[32m+[m[32m  const inNgn = NGN_ENABLED && payIn === "ngn" && country === "NG";[m
   const fmtLocal = (n: number) => `${cfg.currencySymbol}${Number(n).toLocaleString()}`;[m
 [m
   // Reload billers whenever the country changes; reset the in-progress order.[m
[36m@@ -81,6 +91,8 @@[m [mexport default function Home() {[m
   const fixedAmount = item && item.amount > 0;[m
   // FLW returns some countries' fixed prices in minor units (GH: pesewas).[m
   const fixedLocal = item && item.amount > 0 ? item.amount / cfg.fixedAmountDivisor : 0;[m
[32m+[m[32m  const billAmount = fixedAmount ? fixedLocal : Number(amountLocal || 0);[m
[32m+[m[32m  const ngnTotal = billAmount + NGN_FEE;[m
   const isNoValidate = (i: BillerItem | null) =>[m
     !!i && (i.is_airtime || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(i.biller_name + " " + i.name));[m
 [m
[36m@@ -109,6 +121,7 @@[m [mexport default function Home() {[m
         headers: { "Content-Type": "application/json" },[m
         body: JSON.stringify({[m
           country,[m
[32m+[m[32m          payIn: inNgn ? "ngn" : "gbp",[m
           email,[m
           billerCode: item.biller_code,[m
           itemCode: item.item_code,[m
[36m@@ -203,7 +216,31 @@[m [mexport default function Home() {[m
         <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3 text-center">Start here</p>[m
         <h2 className="font-display font-extrabold text-3xl mb-8 text-center">Who are we paying for today — and where?</h2>[m
 [m
[31m-        {/* Step 0 — country */}[m
[32m+[m[32m        {/* Step 00 — where are you paying from? (shown once naira checkout is live) */}[m
[32m+[m[32m        {NGN_ENABLED && ([m
[32m+[m[32m          <div className="bg-panel border border-line rounded-2xl p-5 mb-4">[m
[32m+[m[32m            <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">Where are you paying from?</p>[m
[32m+[m[32m            <div className="flex gap-2 flex-wrap">[m
[32m+[m[32m              {([[m
[32m+[m[32m                { k: "gbp", label: "🇬🇧 UK / abroad — pay in £" },[m
[32m+[m[32m                { k: "ngn", label: "🇳🇬 Nigeria — pay in ₦" },[m
[32m+[m[32m              ] as const).map((o) => ([m
[32m+[m[32m                <button[m
[32m+[m[32m                  key={o.k}[m
[32m+[m[32m                  onClick={() => { setPayIn(o.k); if (o.k === "ngn") { setCountry("NG"); setTab("electricity"); } }}[m
[32m+[m[32m                  className={`px-4 py-2 rounded-full text-sm border ${[m
[32m+[m[32m                    payIn === o.k ? "bg-tungsten text-night border-tungsten font-semibold" : "border-line text-haze hover:border-tungsten/50"[m
[32m+[m[32m                  }`}[m
[32m+[m[32m                >[m
[32m+[m[32m                  {o.label}[m
[32m+[m[32m                </button>[m
[32m+[m[32m              ))}[m
[32m+[m[32m            </div>[m
[32m+[m[32m          </div>[m
[32m+[m[32m        )}[m
[32m+[m
[32m+[m[32m        {/* Step 0 — country (hidden in naira mode: Nigeria only) */}[m
[32m+[m[32m        {!inNgn && ([m
         <div className="bg-panel border border-line rounded-2xl p-5 mb-4">[m
           <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">Country</p>[m
           <div className="flex gap-2 flex-wrap">[m
[36m@@ -222,6 +259,7 @@[m [mexport default function Home() {[m
             ))}[m
           </div>[m
         </div>[m
[32m+[m[32m        )}[m
 [m
         <div className="bg-panel border border-line rounded-2xl p-5 mb-4">[m
           <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">1 · What are you paying?</p>[m
[36m@@ -271,18 +309,29 @@[m [mexport default function Home() {[m
 [m
         {validated && ([m
           <div className="bg-panel border border-line rounded-2xl p-5">[m
[31m-            <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">3 · Pay in pounds</p>[m
[32m+[m[32m            <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">3 · Pay in {inNgn ? "naira" : "pounds"}</p>[m
             <label>Your email (for your receipt)</label>[m
             <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />[m
             <div className="mt-3">[m
               <label>Their WhatsApp (optional — we send them the receipt / token)</label>[m
               <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={country === "GH" ? "+233..." : "+234..."} inputMode="tel" />[m
             </div>[m
[32m+[m[32m            {inNgn && billAmount > 0 && ([m
[32m+[m[32m              <div className="mt-4 rounded-xl border border-line p-4 text-sm">[m
[32m+[m[32m                <div className="flex justify-between text-haze"><span>{item?.name}</span><span>{fmtLocal(billAmount)}</span></div>[m
[32m+[m[32m                <div className="flex justify-between text-haze mt-1"><span>Service fee</span><span>{fmtLocal(NGN_FEE)}</span></div>[m
[32m+[m[32m                <div className="flex justify-between font-semibold mt-2 pt-2 border-t border-line"><span>Total</span><span>{fmtLocal(ngnTotal)}</span></div>[m
[32m+[m[32m              </div>[m
[32m+[m[32m            )}[m
             <button onClick={pay} disabled={busy !== null || !email || (!fixedAmount && !amountLocal)}[m
               className="mt-5 w-full py-3.5 rounded-xl bg-tungsten text-night font-display font-bold text-lg shadow-glow hover:brightness-110 disabled:opacity-40">[m
[31m-              {busy === "pay" ? "Opening secure checkout…" : "Continue to payment"}[m
[32m+[m[32m              {busy === "pay" ? "Opening secure checkout…" : inNgn && billAmount > 0 ? `Pay ${fmtLocal(ngnTotal)}` : "Continue to payment"}[m
             </button>[m
[31m-            <p className="text-haze text-xs mt-3 text-center">Card payment handled by Stripe. If delivery fails, you&rsquo;re refunded automatically — you can never lose money.</p>[m
[32m+[m[32m            <p className="text-haze text-xs mt-3 text-center">[m
[32m+[m[32m              {inNgn[m
[32m+[m[32m                ? "Pay by card, bank transfer or USSD — secured by Paystack. If delivery fails, you\u2019re refunded automatically."[m
[32m+[m[32m                : "Card payment handled by Stripe. If delivery fails, you\u2019re refunded automatically — you can never lose money."}[m
[32m+[m[32m            </p>[m
           </div>[m
         )}[m
 [m
[1mdiff --git a/src/lib/reconcile.ts b/src/lib/reconcile.ts[m
[1mindex a9fe444..190d5f6 100644[m
[1m--- a/src/lib/reconcile.ts[m
[1m+++ b/src/lib/reconcile.ts[m
[36m@@ -17,6 +17,7 @@[m [mexport interface ReconResult {[m
   byStatus: Record<string, number>;[m
   collectedPence: number;[m
   vendedNgn: number;[m
[32m+[m[32m  paystackNgn: number;      // ₦ collected via Paystack on fulfilled orders (incl. fee)[m
   refundedPence: number;[m
   marginPence: number;[m
   flags: { level: "danger" | "warn"; msg: string }[];[m
[36m@@ -64,19 +65,26 @@[m [mexport async function runReconcile(dateStr = yesterdayUTC(), deep = true): Promi[m
 [m
   const [{ data: orders }, charges] = await Promise.all([[m
     db.from("orders")[m
[31m-      .select("i