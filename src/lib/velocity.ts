import { supabaseAdmin } from "@/lib/supabase";

// Velocity checks catch the cashout pattern: one email or IP draining many
// high-value tokens fast. Returns { blocked, reason } — checkout refuses if blocked.
// All thresholds are env-tunable; sensible defaults below.

export async function velocityCheck(params: {
  email: string;
  ip: string;
  amountGbpPence: number;
}): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const db = supabaseAdmin();

    const maxPerEmailDay = Number(process.env.VEL_MAX_ORDERS_EMAIL_DAY ?? "15");
    const maxPerIpHour = Number(process.env.VEL_MAX_ORDERS_IP_HOUR ?? "12");
    const maxValueEmailDayPence = Number(process.env.VEL_MAX_VALUE_EMAIL_DAY_PENCE ?? "50000"); // £500
    const firstOrderCapPence = Number(process.env.VEL_FIRST_ORDER_CAP_PENCE ?? "15000"); // £150

    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();

    // Orders by this email in last 24h (paid or fulfilled = real attempts)
    const { data: emailOrders } = await db
      .from("orders")
      .select("amount_gbp_pence,status,created_at")
      .eq("email", params.email)
      .gte("created_at", dayAgo);

    const realEmail = (emailOrders ?? []).filter((o) =>
      ["paid", "fulfilled", "pending_payment"].includes(o.status)
    );

    // First-order cap: brand-new email can't place a huge first order
    const everFulfilled = (emailOrders ?? []).some((o) => o.status === "fulfilled");
    if (!everFulfilled && params.amountGbpPence > firstOrderCapPence) {
      return { blocked: true, reason: `first_order_cap:${firstOrderCapPence}` };
    }

    if (realEmail.length >= maxPerEmailDay) {
      return { blocked: true, reason: "email_count_day" };
    }

    const emailValueDay = realEmail.reduce((a, o) => a + Number(o.amount_gbp_pence), 0);
    if (emailValueDay + params.amountGbpPence > maxValueEmailDayPence) {
      return { blocked: true, reason: "email_value_day" };
    }

    // Orders from this IP in the last hour (needs ip column — see migration)
    const { count: ipCount } = await db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("ip", params.ip)
      .gte("created_at", hourAgo);
    if ((ipCount ?? 0) >= maxPerIpHour) {
      return { blocked: true, reason: "ip_count_hour" };
    }

    return { blocked: false };
  } catch (e) {
    // Fail OPEN — a velocity-check outage shouldn't block legitimate sales.
    console.error("[velocity] check failed (allowing)", e);
    return { blocked: false };
  }
}
