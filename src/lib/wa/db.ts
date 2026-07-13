// src/lib/wa/db.ts
// WA bot data layer — uses the repo's existing supabaseAdmin() client.

import { supabaseAdmin } from "@/lib/supabase";

export const db = supabaseAdmin();

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
  biller_name?: string;       // e.g. "IKEDC PREPAID" — matches orders.biller_name
  identifier?: string;        // meter number — matches orders.identifier
  identifier_label?: string;  // "Meter Number" — matches orders.identifier_label
  amount_ngn?: number;
  beneficiary_alias?: string;
  // filled after validation / quoting:
  customer_name?: string;
  total_pence?: number;
  service_fee_pence?: number;
  ngn_per_gbp?: number;
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
  biller_name: string | null;
  identifier: string;
  customer_name: string | null;
}

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
    .select("id, alias, biller_code, item_code, biller_name, identifier, customer_name")
    .eq("wa_user_id", waUserId)
    .order("last_used_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Beneficiary[];
}

/** Records the Meta message id; returns true if it was already processed. */
export async function alreadyProcessed(messageId: string): Promise<boolean> {
  const { error } = await db.from("wa_processed_messages").insert({ message_id: messageId });
  if (!error) return false;
  if (error.code === "23505") return true;
  throw error;
}
