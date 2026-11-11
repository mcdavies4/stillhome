"use client";

import { useCallback, useEffect, useState } from "react";
import { pfmMoney, waShareUrl } from "@/lib/payforme-shared";
import type { OwnerLink } from "@/lib/paylink";

// The owner's private page for a bills link: /for/<slug>/manage?k=<secret>. Pause, resume, delete, and see who paid.
export default function Manage({ params }: { params: { slug: string } }) {
  const [key, setKey] = useState("");
  const [v, setV] = useState<OwnerLink | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "deleted">("loading");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);

  const call = useCallback(async (k: string, action: string) => {
    const r = await fetch(`/api/paylink/${params.slug}/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setState("missing"); return; }
    if (d.deleted) { setState("deleted"); return; }
    setV(d); setState("ok");
  }, [params.slug]);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    setKey(k);
    if (!k) { setState("missing"); return; }
    call(k, "view").catch(() => setState("missing"));
  }, [call]);

  async function act(action: string) { setBusy(true); try { await call(key, action); } finally { setBusy(false); setConfirmDel(false); } }

  if (state === "loading") return <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center text-haze">Loading…</main>;
  if (state === "deleted") return <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center"><h1 className="font-display font-extrabold text-3xl">Your link is deleted.</h1><p className="text-haze mt-3">Nobody can pay into it any more. You can make a new one any time.</p></main>;
  if (state === "missing" || !v) return <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center"><h1 className="font-display font-extrabold text-3xl">We couldn&rsquo;t open this page.</h1><p className="text-haze mt-3 leading-relaxed">Use the private link you were given when you made your bills link. If you&rsquo;ve lost it, make a new link.</p></main>;

  const url = `${window.location.origin}/for/${v.slug}`;
  const text = `Hi! You can pay my light, TV, airtime or data bills here, any time, in naira:\n${url}${v.note ? `\n"${v.note}"` : ""}\n\n— ${v.ownerName}`;
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl leading-tight tracking-tight">{v.ownerName}&rsquo;s bills link</h1>
      <p className={`mt-2 font-semibold ${v.active ? "text-ok" : "text-bad"}`} data-testid="status">{v.active ? "On: people can pay it" : "Paused: nobody can pay it"}</p>
      <div className="mt-5 rounded-2xl border border-line p-5">
        <p className="font-display font-bold break-all">{url}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={waShareUrl(text)} target="_blank" rel="noopener noreferrer" className="h-11 px-5 inline-flex items-center rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105">Send on WhatsApp</a>
          <button type="button" onClick={copy} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied ? "Copied" : "Copy link"}</button>
        </div>
      </div>

      <h2 className="font-display font-bold text-xl mt-8">What people can pay</h2>
      <ul className="mt-3 space-y-2">
        {v.items.map((i, n) => (
          <li key={n} className="rounded-xl border border-line p-3.5">
            <p className="font-semibold">{i.label}</p>
            <p className="text-sm text-haze">{i.title} · {i.masked}{i.fixed ? ` · ${pfmMoney(i.fixed)}` : ""}</p>
          </li>
        ))}
      </ul>

      <h2 className="font-display font-bold text-xl mt-8">Who paid</h2>
      {v.payments.length === 0 ? <p className="text-haze mt-2 text-sm">Nobody yet. Send your link to someone.</p> : (
        <ul className="mt-3 space-y-2" data-testid="payments">
          {v.payments.map((p, n) => (
            <li key={n} className="rounded-xl border border-line p-3.5 flex justify-between gap-3">
              <span>{p.name || "Someone"} <span className="text-haze text-sm">· {new Date(p.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></span>
              <span className="num font-semibold">{pfmMoney(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => act(v.active ? "pause" : "resume")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-50">{v.active ? "Pause my link" : "Turn my link back on"}</button>
        {!confirmDel ? (
          <button type="button" onClick={() => setConfirmDel(true)} className="h-11 px-5 rounded-xl border border-bad/40 text-bad font-semibold hover:bg-sunk">Delete my link</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => act("delete")} className="h-11 px-5 rounded-xl bg-bad text-white font-semibold">Yes, delete it for good</button>
        )}
      </div>
    </main>
  );
}
