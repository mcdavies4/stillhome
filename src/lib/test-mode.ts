// True when an order made right now is NOT real money or a real delivery: the bills provider is in sandbox / test
// mode, or the naira pay-in rail is using a test key. Such orders are saved with is_test = true, so the dashboard and
// the daily email leave them out. (In live mode nothing extra is stored: the column defaults to false.)

import { billsTestMode } from "@/lib/bills";
import { paystackIsTestMode } from "@/lib/paystack";
import { flwPayIsTestMode } from "@/lib/flwpay";

export function orderIsTest(rail?: "paystack" | "flutterwave"): boolean {
  if (billsTestMode()) return true;
  if (rail === "flutterwave") return flwPayIsTestMode();
  if (rail === "paystack") return paystackIsTestMode();
  return false;
}
