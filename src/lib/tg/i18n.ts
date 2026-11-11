// src/lib/tg/i18n.ts
// The words the customer sees most: the greeting, the main menu, and the "Done!" / "Payment received" lines.
// Everything else (confirm cards, errors, receipts) stays in English on purpose: those carry money and must be exact.
// Pidgin, Yoruba, Igbo and Hausa wording should be read over by a native speaker before it is promoted.

export const LANGS = [
  { code: "en", label: "English" },
  { code: "pcm", label: "Pidgin" },
  { code: "yo", label: "Yorùbá" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];
export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);

export interface Strings {
  welcome: (name: string) => string;
  menu: string;
  light: string; tv: string; airtime: string; data: string; exam: string;
  bulk: string; gift: string; ask: string; giveaway: string;
  orders: string; saved: string; account: string; help: string;
  done: string; received: string; langSet: string;
}

const en: Strings = {
  welcome: (n) => `Hi${n} 👋 I'm <b>Nolgic</b>. I pay light, TV, airtime and data bills in naira, right here in Telegram.\n\nWhat do you want to pay for?`,
  menu: "What do you want to pay for?",
  light: "⚡ Light", tv: "📺 TV", airtime: "📱 Airtime", data: "🌐 Data", exam: "🎓 Exam PIN",
  bulk: "📦 Bulk airtime", gift: "🎁 Send a gift", ask: "🙏 Ask someone to pay", giveaway: "🎉 Giveaway",
  orders: "🧾 My orders", saved: "⭐ Saved", account: "👤 My account", help: "💬 Help",
  done: "✅ <b>Done!</b>", received: "✅ <b>Payment received.</b>",
  langSet: "Done. I'll use English.",
};

const pcm: Strings = {
  welcome: (n) => `How far${n} 👋 Na <b>Nolgic</b> be this. I dey pay light, TV, airtime and data bills for naira, inside Telegram here.\n\nWetin you wan pay for?`,
  menu: "Wetin you wan pay for?",
  light: "⚡ Light", tv: "📺 TV", airtime: "📱 Airtime", data: "🌐 Data", exam: "🎓 Exam PIN",
  bulk: "📦 Plenty airtime", gift: "🎁 Send gift", ask: "🙏 Ask person to pay", giveaway: "🎉 Giveaway",
  orders: "🧾 My orders", saved: "⭐ Wetin I save", account: "👤 My account", help: "💬 Help",
  done: "✅ <b>E don land!</b>", received: "✅ <b>We don receive your payment.</b>",
  langSet: "Ok. I go dey use Pidgin.",
};

const yo: Strings = {
  welcome: (n) => `Báwo ni${n} 👋 Èmi ni <b>Nolgic</b>. Mo ń san owó iná, TV, airtime àti data ní naira, níbí yìí lórí Telegram.\n\nKí ni o fẹ́ san?`,
  menu: "Kí ni o fẹ́ san?",
  light: "⚡ Iná", tv: "📺 TV", airtime: "📱 Airtime", data: "🌐 Data", exam: "🎓 PIN ìdánwò",
  bulk: "📦 Airtime púpọ̀", gift: "🎁 Fi ẹ̀bùn ránṣẹ́", ask: "🙏 Bẹ ẹnìkan láti san", giveaway: "🎉 Giveaway",
  orders: "🧾 Àwọn ìsanwó mi", saved: "⭐ Àwọn tí mo fi pamọ́", account: "👤 Àkọọ́lẹ̀ mi", help: "💬 Ìrànlọ́wọ́",
  done: "✅ <b>Ó ti parí!</b>", received: "✅ <b>A ti gba owó rẹ.</b>",
  langSet: "Ó dára. N óò máa lo Yorùbá.",
};

const ig: Strings = {
  welcome: (n) => `Ndewo${n} 👋 Abụ m <b>Nolgic</b>. Ana m akwụ ụgwọ ọkụ, TV, airtime na data n'naira, ebe a n'ime Telegram.\n\nGịnị ka ị chọrọ ịkwụ?`,
  menu: "Gịnị ka ị chọrọ ịkwụ?",
  light: "⚡ Ọkụ", tv: "📺 TV", airtime: "📱 Airtime", data: "🌐 Data", exam: "🎓 PIN ule",
  bulk: "📦 Airtime ọtụtụ", gift: "🎁 Zipu onyinye", ask: "🙏 Rịọ onye ka ọ kwụọ", giveaway: "🎉 Giveaway",
  orders: "🧾 Ihe m zụtara", saved: "⭐ Ndị echekwara", account: "👤 Akaụntụ m", help: "💬 Enyemaka",
  done: "✅ <b>Emechala!</b>", received: "✅ <b>Anataala m ụgwọ gị.</b>",
  langSet: "Ọ dị mma. Aga m eji Igbo.",
};

const ha: Strings = {
  welcome: (n) => `Sannu${n} 👋 Ni ne <b>Nolgic</b>. Ina biyan kuɗin wuta, TV, airtime da data a naira, a nan cikin Telegram.\n\nMe kake so ka biya?`,
  menu: "Me kake so ka biya?",
  light: "⚡ Wuta", tv: "📺 TV", airtime: "📱 Airtime", data: "🌐 Data", exam: "🎓 PIN na jarrabawa",
  bulk: "📦 Airtime mai yawa", gift: "🎁 Aika kyauta", ask: "🙏 Roƙi wani ya biya", giveaway: "🎉 Giveaway",
  orders: "🧾 Sayayyata", saved: "⭐ Waɗanda na adana", account: "👤 Asusuna", help: "💬 Taimako",
  done: "✅ <b>An gama!</b>", received: "✅ <b>Mun karɓi kuɗinka.</b>",
  langSet: "To. Zan yi amfani da Hausa.",
};

const TABLE: Record<Lang, Strings> = { en, pcm, yo, ig, ha };
export const T = (lang?: string | null): Strings => (isLang(lang) ? TABLE[lang] : en);
