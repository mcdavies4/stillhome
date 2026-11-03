"use client";

import { useEffect, useState } from "react";

// Founder-only check of the Paybeta exam calls. Uses the admin password already stored by /admin in this tab.
export default function ExamsCheck() {
  const [text, setText] = useState("Checking…");
  const [state, setState] = useState<"run" | "noauth" | "done">("run");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let pass: string | null = null;
    try { pass = sessionStorage.getItem("nolgic-admin"); } catch {}
    if (!pass) { setState("noauth"); return; }
    fetch("/api/admin/exams-debug", { headers: { Authorization: `Bearer ${pass}` } })
      .then(async (r) => {
        const t = await r.text();
        try { setText(JSON.stringify(JSON.parse(t), null, 2)); } catch { setText(`HTTP ${r.status}\n${t.slice(0, 2000)}`); }
        setState("done");
      })
      .catch((e) => { setText(`Request failed: ${String(e?.message ?? e)}`); setState("done"); });
  }, []);

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  return (
    <main id="content" className="max-w-3xl mx-auto px-5 pt-10 pb-24">
      <h1 className="font-display font-bold text-2xl">Exam PIN check</h1>
      {state === "noauth" ? (
        <p className="mt-4 text-haze">Sign in at <a className="underline underline-offset-4" href="/admin">/admin</a> first, then open this page again in the same tab.</p>
      ) : (
        <>
          <p className="mt-2 text-haze text-sm">What Paybeta returned for the exam calls. Field names, codes and prices only. Copy all of it and send it to Claude.</p>
          <button type="button" onClick={copy} disabled={state !== "done"} className="mt-4 h-11 px-5 rounded-xl border border-line font-medium hover:bg-sunk disabled:opacity-40">{copied ? "Copied" : "Copy all"}</button>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-2xl bg-sunk p-4 text-xs leading-relaxed font-mono">{text}</pre>
        </>
      )}
    </main>
  );
}
