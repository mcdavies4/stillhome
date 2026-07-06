// Pricing: you set NGN_PER_GBP below mid-market; the spread + flat fee is margin.

export type Quote = {
  amountNgn: number;
  ngnPerGbp: number;
  serviceFeePence: number;
  subtotalPence: number;
  totalPence: number;
};

export function quoteGbp(amountNgn: number): Quote {
  const ngnPerGbp = Number(process.env.NGN_PER_GBP ?? "2000");
  const serviceFeePence = Number(process.env.SERVICE_FEE_PENCE ?? "99");
  const min = Number(process.env.MIN_ORDER_NGN ?? "50");
  const max = Number(process.env.MAX_ORDER_NGN ?? "500000");

  if (!Number.isFinite(amountNgn) || amountNgn < min || amountNgn > max) {
    throw new Error(`Amount must be between ₦${min.toLocaleString()} and ₦${max.toLocaleString()}`);
  }
  const subtotalPence = Math.ceil((amountNgn / ngnPerGbp) * 100);
  return {
    amountNgn,
    ngnPerGbp,
    serviceFeePence,
    subtotalPence,
    totalPence: subtotalPence + serviceFeePence,
  };
}

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
export const ngn = (n: number) => `₦${Number(n).toLocaleString("en-NG")}`;
