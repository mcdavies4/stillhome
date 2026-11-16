"use client";

// Shows a Flutterwave bank account for a pending naira order. The account is temporary and expires.
// The order page already refreshes itself, so once the transfer arrives the status changes on its own.

import { useEffect, useState } from "react";

type Acct = { accountNumber: string; bankName: string; amountNgn: number; expiresAt: string | null };

export default function PayByTransfer({ orderId, autoStart }: { orderId: string; autoStart?: boolean }) {
  const [acct, setAcct] = useState<Acct | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/flutterwave/transfer-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Couldn't create a bank account. Please try again.");
      else setAcct(d as Acct);
    } catch {
      setErr("Couldn't reach Nolgic. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const expired = !!acct?.expiresAt && new Date(acct.expiresAt.replace(" ", "T") + "Z").getTime() < Date.now();

  return (
    <div className="mt-6 rounded-2xl border border-line p-5">
      <p className="font-display font-bold">Pay by bank transfer</p>
      {!acct && (
        <>
          <p className="text-haze text-sm leading-relaxed mt-1.5">
            Get a bank account for this exact amount and transfer from your own bank app. Your order is completed as soon as the transfer arrives.
          </p>
          <button type="button" onClick={start} disabled={busy}
            className="mt-4 h-11 px-5 rounded-xl bg-tungsten text-white dark:text-night font-bold disabled:opacity-60">
            {busy ? "Getting your account…" : "Get bank account"}
          </button>
        </>
      )}
      {err && <p className="mt-3 text-sm text-red-500">{err}</p>}
      {acct && !expired && (
        <div className="mt-4 space-y-3 text-[15px]">
          <div className="flex justify-between gap-4"><span className="text-haze">Bank</span><span>{acct.bankName}</span></div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-haze">Account number</span>
            <span className="font-mono text-xl font-bold">{acct.accountNumber}</span>
          </div>
          <div className="flex justify-between gap-4"><span className="text-haze">Amount</span><span className="font-bold">₦{Number(acct.amountNgn).toLocaleString("en-NG")}</span></div>
          {acct.expiresAt && (
            <div className="flex justify-between gap-4"><span className="text-haze">Valid until</span><span>{new Date(acct.expiresAt.replace(" ", "T") + "Z").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></div>
          )}
          <button type="button" onClick={() => { navigator.clipboard?.writeText(acct.accountNumber); setCopied(true); }}
            className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">
            {copied ? "Copied" : "Copy account number"}
          </button>
          <p className="text-haze text-xs">Send exactly this amount. A different amount, or a transfer after the time above, can't be matched to this order.</p>
        </div>
      )}
      {acct && expired && (
        <p className="mt-3 text-sm">This account has expired. Start a new order from the home page to get another one.</p>
      )}
    </div>
  );
}
