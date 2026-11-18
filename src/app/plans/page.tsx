"use client";

// /plans — see, pause, resume or cancel every monthly payment set up with one email.
// Opened from a sign-in link (?token=…). Without a token, asks for the email and sends a link.

import { useEffect, useRef, useState } from "react";

type Plan = {
  id: string;
  biller_name: string;
  identifier: string;
  identifier_label: string;
  customer_name: string | null;
  amount_ngn: number;
  status: "active" | "on_hold" | "needs_action" | "paused";
  next_run_on: string | null;
  card_last4: string | null;
  card_brand: string | null;
  failures: number;
  pending_amount_ngn: number | null;
  history: { at: string; order_id: string | null; amount_ngn: number | null; fee_ngn: number | null }[];
};

const NAIRA = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const DATE = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00+01:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "";

const STATUS: Record<Plan["status"], string> = {
  active: "Active",
  on_hold: "Paused",
  needs_action: "Action needed",
  paused: "Paused after failed payments",
};

const NAVY = "#0B1026";
const AMBER = "#FFB627";

export default function PlansPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  // Plans statuses that still have a card on file, so "replace card" makes sense.
  const noticeRef = useRef<HTMLDivElement>(null);

  // Bring the confirmation into view, so it is never missed below the fold.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [notice]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    setChecked(true);
    if (t) load(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(t: string) {
    const res = await fetch(`/api/plans?token=${encodeURIComponent(t)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "This link is not valid."); setPlans(null); return; }
    setOwner(data.email);
    setPlans(data.plans);
  }

  async function requestLink(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    setError(null); setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { setError("Enter the email you paid with, for example name@example.com."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? `Something went wrong (code ${res.status}). Try again.`); return; }
      setNotice(data.message);
    } catch {
      setError("Could not reach Nolgic. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function act(plan: Plan, action: "pause" | "resume" | "cancel" | "approve_price") {
    if (action === "cancel" && !window.confirm(`Cancel the monthly payment for ${plan.biller_name}? This can't be undone.`)) return;
    if (action === "approve_price" && !window.confirm(`Approve the new price of ${NAIRA(plan.pending_amount_ngn ?? 0)} for ${plan.biller_name}? We'll charge it from your next charge date.`)) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "act", token, planId: plan.id, do: action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not change this plan."); if (action === "approve_price") load(token!); return; }
    setPlans(data.plans);
  }

  const shell = (children: React.ReactNode) => (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px", color: NAVY }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>Monthly payments</h1>
      {children}
    </main>
  );

  if (!checked) return shell(null);

  // No link yet: ask for the email.
  if (!token) {
    return shell(
      <>
        <p style={{ lineHeight: 1.6 }}>Enter the email you used at checkout. We'll send a link to see, pause or cancel your monthly payments.</p>
        <form onSubmit={requestLink} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <input
            type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" aria-label="Email"
            style={{ flex: "1 1 260px", padding: "12px 14px", borderRadius: 10, border: "1px solid #cfd3de", fontSize: 16 }}
          />
          <button type="button" onClick={() => requestLink()} disabled={busy} style={{ background: AMBER, color: NAVY, fontWeight: 800, padding: "12px 18px", borderRadius: 10, border: 0, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Sending…" : "Send me a link"}
          </button>
        </form>
        {notice && (
          <div ref={noticeRef} role="status" style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, background: "#E7F6EC", border: "1px solid #7CC79A", color: "#14532d", fontWeight: 600, lineHeight: 1.5 }}>
            ✓ {notice}
          </div>
        )}
        {error && <p role="alert" style={{ marginTop: 16, color: "#b42318" }}>{error}</p>}
      </>
    );
  }

  // Link opened: show plans.
  if (plans === null) {
    return shell(error ? <p role="alert" style={{ color: "#b42318" }}>{error} <a href="/plans" style={{ color: NAVY, fontWeight: 700 }}>Request a new link</a></p> : <p>Loading…</p>);
  }

  const live = plans.filter((p) => p.status !== "paused");

  return shell(
    <>
      <p style={{ lineHeight: 1.6 }}>Signed in as <b>{owner}</b>. Pausing skips the next charge. You can restart any time.</p>
      {plans.length === 0 && <p style={{ marginTop: 24 }}>You have no monthly payments set up.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "24px 0 0", display: "grid", gap: 14 }}>
        {plans.map((p) => (
          <li key={p.id} style={{ border: "1px solid #e3e6ee", borderRadius: 14, padding: 18, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{p.biller_name}</div>
                <div style={{ color: "#4b5266", marginTop: 4 }}>{p.identifier_label} {p.identifier}{p.customer_name ? ` · ${p.customer_name}` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800 }}>{NAIRA(p.amount_ngn)} a month</div>
                <div style={{ fontSize: 14, color: p.status === "needs_action" ? "#b42318" : "#4b5266", marginTop: 4 }}>{STATUS[p.status]}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 14, color: "#4b5266" }}>
              {p.status === "active" && p.next_run_on && <>Next charge: {DATE(p.next_run_on)}</>}
              {p.status === "on_hold" && <>No charges until you resume.</>}
              {p.status === "needs_action" && p.pending_amount_ngn && <>The price changed from {NAIRA(p.amount_ngn)} to <b>{NAIRA(p.pending_amount_ngn)}</b>. Approve it to keep this payment going. Nothing is charged at the new price until you do.</>}
              {p.status === "needs_action" && !p.pending_amount_ngn && <>We need you to check your email from Nolgic before the next charge.</>}
              {p.status === "paused" && <>Paused after {p.failures} failed payments. Resume to try again.</>}
              {p.card_last4 && <> · Card ending {p.card_last4}</>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {p.status === "needs_action" && p.pending_amount_ngn && <Btn onClick={() => act(p, "approve_price")} disabled={busy}>Approve {NAIRA(p.pending_amount_ngn)}</Btn>}
              {p.status === "active" && <Btn onClick={() => act(p, "pause")} disabled={busy}>Pause</Btn>}
              {(p.status === "on_hold" || p.status === "paused") && <Btn onClick={() => act(p, "resume")} disabled={busy}>Resume</Btn>}
              <Btn onClick={() => act(p, "cancel")} disabled={busy} danger>Cancel</Btn>
            </div>
              <p style={{ marginTop: 12, fontSize: 13, color: "#4b5266" }}>
                Changed card? <a href="/#pay" style={{ color: NAVY, fontWeight: 700 }}>Pay this bill once with your new card</a> and tick "Repeat monthly". Your old plan for this bill is replaced automatically.
              </p>
            {p.history.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid #e3e6ee", paddingTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Past charges</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4, fontSize: 14 }}>
                  {p.history.map((h, i) => (
                    <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}{h.amount_ngn ? ` · ${NAIRA(h.amount_ngn + (h.fee_ngn ?? 0))}` : ""}</span>
                      {h.order_id && <a href={`/order/${h.order_id}`} style={{ color: NAVY, fontWeight: 700 }}>Receipt</a>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" style={{ marginTop: 16, color: "#b42318" }}>{error}</p>}
      {live.length > 0 && <p style={{ marginTop: 24, fontSize: 14, color: "#4b5266" }}>We'll email you a day before each charge.</p>}
    </>
  );
}

function Btn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
        border: danger ? "1px solid #b42318" : `1px solid ${NAVY}`,
        background: "#fff", color: danger ? "#b42318" : NAVY,
      }}
    >
      {children}
    </button>
  );
}
