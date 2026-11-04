"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

// Opened from the "Stop these reminders" link in a top-up reminder email. Nothing changes until the button is pressed.
export default function StopReminders() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"ask" | "busy" | "done" | "bad">("ask");
  const [error, setError] = useState("");

  async function stop() {
    setState("busy"); setError("");
    try {
      const r = await fetch("/api/reminders/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (r.status === 404 || r.status === 400) { setState("bad"); return; }
      if (!r.ok) { setError("Something went wrong. Please try again."); setState("ask"); return; }
      setState("done");
    } catch { setError("Can't reach Nolgic. Check your connection and try again."); setState("ask"); }
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      {state === "done" ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">Reminders stopped</h1>
          <p className="mt-3 text-haze text-lg">We won&rsquo;t send you top-up reminders again. Receipts for your orders still arrive as normal.</p>
        </>
      ) : state === "bad" ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">This link isn&rsquo;t valid</h1>
          <p className="mt-3 text-haze">It may be mistyped. Write to nolgichq@gmail.com and we&rsquo;ll stop the reminders for you.</p>
        </>
      ) : (
        <>
          <h1 className="font-display font-extrabold text-3xl">Stop top-up reminders?</h1>
          <p className="mt-3 text-haze text-lg leading-relaxed">We&rsquo;ll stop emailing you when your light or TV may be running low. Your receipts are not affected.</p>
          {error && <p className="text-bad text-sm mt-3" role="alert">{error}</p>}
          <button type="button" onClick={stop} disabled={state === "busy"} className="mt-6 h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-60">
            {state === "busy" ? "Stopping…" : "Stop reminders"}
          </button>
        </>
      )}
    </main>
  );
}
