// GET /api/optout?token=… — one-click unsubscribe from marketing email. Plan receipts and charge reminders still send.
import { verifyLink, optOut } from "@/lib/plan-manage";

export const dynamic = "force-dynamic";

const page = (title: string, text: string, status = 200) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f5f8;font-family:system-ui,Arial,sans-serif;color:#12151e">
<div style="max-width:520px;margin:48px auto;background:#fff;padding:28px;border-radius:16px">
<div style="color:#0B1026;font-weight:800;font-size:20px">Nolgic</div>
<h1 style="font-size:22px;margin:16px 0 8px">${title}</h1><p style="line-height:1.6">${text}</p>
<p><a href="https://nolgic.com" style="color:#0B1026;font-weight:700">Back to nolgic.com</a></p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

async function handle(req: Request) {
  const email = verifyLink("optout", new URL(req.url).searchParams.get("token"));
  if (!email) return page("Link not valid", "This unsubscribe link isn't valid. Reply to any Nolgic email and we'll remove you.", 400);
  await optOut(email, "link");
  return page("You're unsubscribed", "You won't get marketing emails from Nolgic. You'll still get receipts and reminders for any monthly payments you've set up.");
}

// Email clients that support one-click unsubscribe POST to this URL too.
export const GET = handle;
export const POST = handle;
