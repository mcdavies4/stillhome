"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pfmMoney, pfmTitle, tokenShareText, waShareUrl, type PfmItemState, type PfmView } from "@/lib/payforme-shared";
import { supportLink } from "@/lib/support-contact";

// The page behind a Pay for Me link.
//   Payer     /r/<id>            sees exactly what they are paying for, pays, watches it get delivered.
//   Owner     /r/<id>?k=<secret> the person who asked: the same page, plus the tokens and a Cancel button.
const niceName = (n: string) => n.replace(/\s+VTU$/i, "");
const BADGE: Record<PfmItemState, { text: string; cls: string }> = {
  waiting: { text: "Waiting", cls: "text-haze" },
  working: { text: "Buying…", cls: "text-tungsten" },
  delivered: { text: "Delivered", cls: "text-ok" },
  refunded: { text: "Refunded", cls: "text-bad" },
  checking: { text: "Checking", cls: "text-tungsten" },
};

export default function RequestPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [v, setV] = useState<PfmView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [key, setKey] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const [email, setEmail] = useState("");
  const [payer, setPayer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const alive = useRef(true);
  const wa = supportLink({});

  const load = useCallback(async (k: string | null) => {
    try {
      const r = await fetch(`/api/payforme/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`, { cache: "no-store" });
      if (r.status === 404) { if (alive.current) setState("missing"); return null; }
      if (!r.ok) throw new Error("bad");
      const d = (await r.json()) as PfmView;
      if (alive.current) { setV(d); setState("ok"); }
      return d;
    } catch { if (alive.current && !v) setState("error"); return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // First load, and polling while anything is still happening.
  useEffect(() => {
    alive.current = true;
    const sp = new URLSearchParams(window.location.search);
    const k = sp.get("k");
    setKey(k); setReturned(sp.get("paid") === "1");
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load(k);
      if (!alive.current) return;
      const live = d && (d.status === "working" || (d.status === "paying" && sp.get("paid") === "1") || d.status === "checking");
      if (Date.now() - since > 60_000) setSlow(true);
      if (live || !d) timer = setTimeout(tick, d ? 3000 : 6000);
    };
    tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [load]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/payforme/${id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name: payer || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) { setErr(d.error || "We couldn't start the payment. Please try again."); setBusy(false); return; }
      window.location.href = d.url;
    } catch { setErr("Can't reach Nolgic. Check your connection and try again."); setBusy(false); }
  }

  async function cancel() {
    if (!key || !confirm("Cancel this request? The link will stop working.")) return;
    const r = await fetch(`/api/payforme/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setErr(d.error || "Could not cancel."); else load(key);
  }

  async function copy(t: string, tag: string) {
    try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
    setCopied(tag); setTimeout(() => setCopied(null), 1800);
  }

  if (state === "loading") return <main id="content" className="max-w-xl mx-auto px-5 pt-14 pb-24"><p className="text-haze" role="status">Loading…</p></main>;
  if (state === "missing" || (state === "error" && !v)) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-14 pb-24">
        <h1 className="font-display font-extrabold text-3xl leading-tight">{state === "missing" ? "We can't find this request" : "We couldn't load this"}</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">{state === "missing" ? "The link may be incomplete. Ask the person who sent it to send it again." : "Check your connection and refresh the page."}</p>
      </main>
    );
  }
  if (!v) return null;

  const payable = v.status === "open" || (v.status === "paying" && !returned);
  const confirming = v.status === "paying" && returned;
  const showTokens = v.owner && v.items.some((i) => i.state === "delivered");

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      {payable && (
        <>
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">{v.receiverName} is asking you to pay {pfmMoney(v.total)}</h1>
          {v.note && <p className="mt-3 text-lg leading-relaxed border-l-2 border-tungsten pl-4" data-testid="note">&ldquo;{v.note}&rdquo;</p>}
          <p className="mt-3 text-haze leading-relaxed">This is exactly what your payment buys. Nothing else.</p>
        </>
      )}
      {confirming && <><h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Confirming your payment</h1><p className="mt-3 text-haze text-lg" role="status">This takes a few seconds. You can keep this page open.</p></>}
      {v.status === "working" && <><h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Payment received</h1><p className="mt-3 text-haze text-lg" role="status">We are buying everything now. Each item turns to Delivered as it lands.</p></>}
      {v.status === "done" && <><h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight" data-testid="done">{v.owner ? "It's all done" : `Done. ${v.receiverName} is sorted`}</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">{v.refunded > 0 ? (v.owner ? `Part of it could not be delivered, so ${pfmMoney(v.refunded)} was refunded to whoever paid.` : `${pfmMoney(v.refunded)} went back to your card for what could not be delivered.`) : "Everything was delivered."}{v.owner ? "" : " A receipt is on its way to your email."}</p></>}
      {v.status === "checking" && <><h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">We&rsquo;re checking something</h1><p className="mt-3 text-haze text-lg leading-relaxed">Your payment is safe. One of the items needs a second look, and we will email you as soon as it is sorted. You do not need to pay again.</p></>}
      {v.status === "cancelled" && <><h1 className="font-display font-extrabold text-3xl leading-tight">{v.receiverName} cancelled this request</h1><p className="mt-3 text-haze text-lg">Nothing was charged.</p></>}
      {v.status === "expired" && <><h1 className="font-display font-extrabold text-3xl leading-tight">This request has expired</h1><p className="mt-3 text-haze text-lg leading-relaxed">Nothing was charged. Ask {v.receiverName} to send a new one.</p></>}

      {(v.status !== "cancelled" && v.status !== "expired") && (
        <ul className="mt-7 space-y-2.5" data-testid="items">
          {v.items.map((i) => (
            <li key={i.n} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{pfmTitle(i.billerName, i.itemName)}</p>
                  <p className="text-sm text-haze break-all">{i.label}: {i.identifier}</p>
                  {i.customerName && <p className="text-sm mt-0.5">For <span className="font-semibold">{i.customerName}</span></p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="num font-semibold">{pfmMoney(i.amount)}</p>
                  {v.status !== "open" && v.status !== "paying" && <p className={`text-xs font-semibold mt-0.5 ${BADGE[i.state].cls}`}>{BADGE[i.state].text}</p>}
                </div>
              </div>
              {v.owner && i.state === "delivered" && (
                <div className="mt-3 pt-3 border-t border-line">
                  {i.token ? (
                    <>
                      <p className="text-xs text-haze">Your token</p>
                      <p className="font-mono text-lg tracking-wider break-all" data-testid="token">{i.token}</p>
                    </>
                  ) : /ELECTRIC|DISCO|PREPAID/i.test(i.billerName) ? <p className="text-sm text-haze">The token is on its way. This page updates by itself.</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={waShareUrl(tokenShareText({ billerName: niceName(i.billerName), identifier: i.identifier, token: i.token, customerName: i.customerName }))} target="_blank" rel="noopener noreferrer" className="h-10 px-4 inline-flex items-center rounded-lg bg-[#25D366] text-[#0b2a16] text-sm font-bold hover:brightness-105">Send on WhatsApp</a>
                    {i.token && <button type="button" onClick={() => copy(i.token!, `t${i.n}`)} className="h-10 px-4 rounded-lg border border-paper/25 text-sm font-semibold hover:bg-sunk">{copied === `t${i.n}` ? "Copied" : "Copy token"}</button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(v.status !== "cancelled" && v.status !== "expired") && (
        <dl className="mt-5 text-sm space-y-1.5 px-1">
          <div className="flex justify-between"><dt className="text-haze">Bills</dt><dd className="num">{pfmMoney(v.amount)}</dd></div>
          <div className="flex justify-between"><dt className="text-haze">Service fees</dt><dd className="num">{pfmMoney(v.fee)}</dd></div>
          <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-line"><dt>Total</dt><dd className="num" data-testid="total">{pfmMoney(v.total)}</dd></div>
          {v.refunded > 0 && <div className="flex justify-between text-ok"><dt>Refunded</dt><dd className="num">−{pfmMoney(v.refunded)}</dd></div>}
        </dl>
      )}

      {payable && (
        <>
          <div className="mt-6 rounded-xl border border-tungsten/40 bg-cta/10 p-4 text-sm leading-relaxed">
            <p className="font-semibold">Only pay if you know {v.receiverName} and expected this.</p>
            <p className="text-haze mt-1">What you buy goes straight to the meters and numbers above and can&rsquo;t be taken back once delivered. Anything we can&rsquo;t deliver is refunded automatically.</p>
          </div>
          {v.owner ? (
            <div className="mt-6 rounded-2xl border border-line p-5">
              <p className="font-display font-bold">This is your request</p>
              <p className="text-haze text-sm leading-relaxed mt-1.5">Nobody has paid yet. Send the link to the person who will pay. Your tokens appear on this page once they do.</p>
              {v.canCancel && <button type="button" onClick={cancel} className="mt-3 h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Cancel this request</button>}
            </div>
          ) : (
            <form onSubmit={pay} className="mt-6" noValidate>
              <label htmlFor="payer-email">Your email, for your receipt</label>
              <input id="payer-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              <div className="mt-3">
                <label htmlFor="payer-name">Your first name <span className="text-haze font-normal">(optional)</span></label>
                <input id="payer-name" autoComplete="given-name" value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={60} placeholder="So they know it was you" />
              </div>
              {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
              <button type="submit" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)}
                className="mt-5 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
                {busy ? "Taking you to the payment page…" : `Pay ${pfmMoney(v.total)} by card`}
              </button>
              <p className="text-xs text-haze mt-2.5 leading-relaxed">UK and international cards work. You will be taken to a secure payment page. You pay in naira, and your bank shows the exchange rate.</p>
            </form>
          )}
        </>
      )}

      {confirming && slow && <p className="mt-6 text-sm text-haze" role="status">This is taking longer than usual. You can close this page: we will email your receipt as soon as the payment is confirmed.</p>}
      {v.status === "working" && slow && <p className="mt-6 text-sm text-haze" role="status">Still working. You can close this page: we will email you when everything is done.</p>}
      {showTokens && v.status === "done" && <p className="mt-6 text-sm text-haze">Save this page. It is the only place your tokens live, along with the email we sent if you gave one.</p>}
      {v.owner && !payable && err && <p className="text-bad text-sm mt-4" role="alert">{err}</p>}

      <div className="mt-10 rounded-2xl border border-line p-5">
        <p className="font-display font-bold">Need help?</p>
        <p className="text-haze text-sm leading-relaxed mt-1.5">Email <a className="text-tungsten underline underline-offset-2" href="mailto:nolgichq@gmail.com">nolgichq@gmail.com</a>{wa ? " or message us on WhatsApp" : ""}.</p>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 px-5 items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Message us on WhatsApp</a>}
      </div>
    </main>
  );
}
