// src/lib/wa/db.ts
// Server-only Supabase client (service role) + shared types for the WA bot.

import { createClient } from "@supabase/supabase-js";

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export type ConversationState =
  | "idle"
  | "collecting"
  | "confirming"
  | "awaiting_payment"
  | "vending"
  | "failed";

export interface Draft {
  biller_code?: string;
  item_code?: string;
  biller_label?: string;      // human label for messages, e.g. "IKEDC Prepaid"
  meter_number?: string;
  meter_type?: "prepaid" | "postpaid";
  amount_ngn?: number;
  beneficiary_alias?: string;
  save_beneficiary?: boolean;
  // filled after validation / quoting:
  customer_name?: string;
  quoted_gbp?: number;        // pence-safe: store as number of pounds with 2dp
  fx_rate?: number;
  quoted_at?: string;
}

export interface WaUser {
  id: string;
  wa_phone: string;
  display_name: string | null;
  welcomed: boolean;
  order_count: number;
}

export interface Conversation {
  id: string;
  wa_user_id: string;
  state: ConversationState;
  draft: Draft;
  order_id: string | null;
  expires_at: string | null;
}

export interface Beneficiary {
  id: string;
  alias: string;
  biller_code: string;
  item_code: string;
  meter_number: string;
  customer_name: string | null;
  meter_type: string | null;
}

/** Upsert the WhatsApp user and return the row. */
export async function upsertWaUser(waPhone: string, displayName?: string): Promise<WaUser> {
  const { data, error } = await db
    .from("wa_users")
    .upsert(
      { wa_phone: waPhone, display_name: displayName ?? null, last_seen_at: new Date().toISOString() },
      { onConflict: "wa_phone" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as WaUser;
}

/** Get or create the single conversation row for a user. */
export async function getConversation(waUserId: string): Promise<Conversation> {
  const { data, error } = await db
    .from("wa_conversations")
    .upsert({ wa_user_id: waUserId }, { onConflict: "wa_user_id", ignoreDuplicates: false })
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function setConversation(
  waUserId: string,
  patch: Partial<Pick<Conversation, "state" | "draft" | "order_id" | "expires_at">>
): Promise<void> {
  const { error } = await db
    .from("wa_conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("wa_user_id", waUserId);
  if (error) throw error;
}

export async function resetConversation(waUserId: string): Promise<void> {
  await setConversation(waUserId, { state: "idle", draft: {}, order_id: null, expires_at: null });
}

export async function getBeneficiaries(waUserId: string): Promise<Beneficiary[]> {
  const { data, error } = await db
    .from("wa_beneficiaries")
    .select("id, alias, biller_code, item_code, meter_number, customer_name, meter_type")
    .eq("wa_user_id", waUserId)
    .order("last_used_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Beneficiary[];
}

/** True if this Meta message id was already processed (and records it if not). */
export async function alreadyProcessed(messageId: string): Promise<boolean> {
  const { error } = await db.from("wa_processed_messages").insert({ message_id: messageId });
  if (!error) return false;                    // inserted fresh → not processed before
  if (error.code === "23505") return true;     // unique violation → duplicate delivery
  throw error;
}
