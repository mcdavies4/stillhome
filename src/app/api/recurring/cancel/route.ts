// GET /api/recurring/cancel?key=<manage key from the email>
// Cancels a monthly repeat. The key is a secret from the email, so no login is needed. Idempotent.
import { cancelByKey } from "@/lib/recurring";

export const dynamic = "force-dynamic";

const page = (title: string, text: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f5f8;font-family:system-ui,Arial,sans-serif;color:#12151e">
<div style="max-width:520px;margin:48px auto;background:#fff;padding:28px;border-radius:16px">
<div style="color:#0B1026;font-weight:800;font-size:20px">Nolgic</div>
<h1 style="font-size:22px;margin:16px 0 8px">${title}</h1><p style="line-height:1.6">${text}</p>
<p><a href="https://nolgic.com" style="color:#0B1026;font-weight:700">Back to nolgic.com</a></p></div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const r = await cancelByKey(key);
  if (!r.ok) return page("Link not found", "This cancel link isn't valid. If you still want to stop a monthly payment, reply to any Nolgic email and we'll do it for you.");
  return page("Monthly payment cancelled", `We won't charge you for ${r.biller ?? "this bill"} again.`);
}
