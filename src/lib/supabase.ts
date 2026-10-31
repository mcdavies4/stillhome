import { createClient } from "@supabase/supabase-js";

// Service-role client — server only (webhooks, fulfilment). Bypasses RLS.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      // Next.js caches fetch() GETs by default. Order status, balances and payment checks must always be live.
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) },
    }
  );
}
