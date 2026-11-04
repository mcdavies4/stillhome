// Names that are never an electricity company: TV and phone-network brands.
// Used so a TV or network provider can never show up in the electricity list,
// whatever a provider's own catalogue says. Safe on both server and browser.
export const NOT_POWER_RX = /\b(DSTV|GOTV|STARTIMES|SHOWMAX|CABLE|SMILE|SPECTRANET|MTN|GLO|AIRTEL|9MOBILE|ETISALAT|AIRTIME|VTU|DATA)\b/i;
export const notPower = (text: string) => NOT_POWER_RX.test(text);
