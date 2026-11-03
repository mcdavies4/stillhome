import AsyncStorage from "@react-native-async-storage/async-storage";

// Nolgic has no accounts, so the phone remembers recent orders and the last email used.
export type SavedOrder = { id: string; biller: string; identifier: string; amount: number; at: number; kind?: "bulk" };
const ORDERS = "nolgic.orders.v1";
const EMAIL = "nolgic.email.v1";

export async function loadOrders(): Promise<SavedOrder[]> {
  try { return JSON.parse((await AsyncStorage.getItem(ORDERS)) ?? "[]"); } catch { return []; }
}
export async function addOrder(o: SavedOrder) {
  try {
    const all = (await loadOrders()).filter((x) => x.id !== o.id);
    await AsyncStorage.setItem(ORDERS, JSON.stringify([o, ...all].slice(0, 40)));
  } catch {}
}
export async function loadEmail(): Promise<string> {
  try { return (await AsyncStorage.getItem(EMAIL)) ?? ""; } catch { return ""; }
}
export async function saveEmail(e: string) {
  try { await AsyncStorage.setItem(EMAIL, e); } catch {}
}
