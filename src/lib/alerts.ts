// Founder alerts via Resend (songsnap.online verified domain pattern).
// Non-fatal: alerting must never break the payment pipeline.

export async function alertFounder(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) {
    console.error(`[ALERT-NOEMAIL] ${subject}: ${text}`);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM ?? "StillHome <alerts@songsnap.online>",
        to: [to],
        subject: `[StillHome] ${subject}`,
        text,
      }),
    });
  } catch (e) {
    console.error("[alerts] failed", e);
  }
}
