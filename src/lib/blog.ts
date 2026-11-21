// Blog posts for nolgic.com. Add a post here and it appears on /blog, gets its own page and joins the sitemap.
// Keep claims to what Nolgic actually does (see /legal). No delivery-time promises, no competitor names.

export type Section = { heading: string; paras: string[] };
export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  sections: Section[];
};

export const posts: Post[] = [
  {
    slug: "how-to-pay-dstv-online-nigeria",
    title: "How to pay DStv online in Nigeria",
    description: "Pay a DStv subscription from your phone in naira. Check the name on the smartcard before you pay.",
    date: "2026-11-17",
    sections: [
      {
        heading: "What you need",
        paras: [
          "You need the smartcard or IUC number printed on your DStv decoder or on your account. Choose the package you want to renew or change.",
        ],
      },
      {
        heading: "Steps",
        paras: [
          "Open the TV section on nolgic.com, pick DStv, and enter the smartcard or IUC number. Nolgic shows the account name linked to that number. Check that it is yours before you continue.",
          "Choose the package and check the total. The total includes a small service fee, shown on its own line, before you pay.",
          "Pay with your card in naira on the secure payment page. Your card details never reach Nolgic.",
        ],
      },
      {
        heading: "Before you pay",
        paras: [
          "Once a subscription has been delivered to the smartcard you confirmed, it cannot be moved to a different decoder. Double-check the number first.",
        ],
      },
    ],
  },
  {
    slug: "how-to-buy-airtime-and-data-online-nigeria",
    title: "How to buy airtime and data online in Nigeria",
    description: "Top up airtime or buy data for MTN, Glo, Airtel or 9mobile from your phone, in naira.",
    date: "2026-11-17",
    sections: [
      {
        heading: "Steps",
        paras: [
          "Open the airtime or data section on nolgic.com. Pick your network: MTN, Glo, Airtel or 9mobile.",
          "Enter the phone number that should receive the top-up, then the amount or data plan. Check the number carefully, because airtime and data have no account-name check.",
          "Review the total, which includes a small service fee, and pay in naira. The top-up is sent to the number you entered.",
        ],
      },
      {
        heading: "If something looks wrong",
        paras: [
          "If you enter the wrong number, a delivered top-up cannot be reversed. If a payment does not go through, we refund you as described in our refund policy.",
        ],
      },
    ],
  },
  {
    slug: "pay-someone-else-s-bill-from-abroad",
    title: "Pay a bill for someone in Nigeria from abroad",
    description: "Send a family member in Nigeria a link so they can choose their own bill, and you pay it from wherever you are.",
    date: "2026-11-17",
    sections: [
      {
        heading: "Why it helps",
        paras: [
          "Many people in the diaspora pay electricity, TV or airtime for relatives at home. Pay for Me lets the person in Nigeria choose what needs paying, then you pay it online.",
        ],
      },
      {
        heading: "How it works",
        paras: [
          "The person in Nigeria creates a request on nolgic.com with the bills they need paid. They share the link with you.",
          "You open the link, check each bill and its total, and pay in naira. Nolgic then pays each bill to the number or meter the request lists.",
        ],
      },
      {
        heading: "Check before you pay",
        paras: [
          "Make sure the meter, smartcard or phone number on the request is the right one. Once a bill has been delivered to that number, it cannot be reversed.",
        ],
      },
    ],
  },
  {
    slug: "how-to-pay-electricity-bill-online-nigeria",
    title: "How to pay your electricity bill online in Nigeria",
    description: "Pay prepaid electricity from your phone in naira. Check the meter number and account name before you pay.",
    date: "2026-11-17",
    sections: [
      {
        heading: "What you need",
        paras: [
          "You need your meter number, which is printed on the meter and on past receipts. Check that it is the meter for the property you are paying for.",
        ],
      },
      {
        heading: "Steps",
        paras: [
          "Open the electricity section on nolgic.com and enter your meter number. Where the provider supports it, Nolgic shows the account name linked to that meter. Confirm it before you continue.",
          "Enter the amount you want to buy. The total shown includes a small service fee, listed on its own line, before you pay.",
          "Pay in naira on the secure payment page. Your token is sent for delivery to the meter you confirmed.",
        ],
      },
      {
        heading: "Before you pay",
        paras: [
          "Once a token has been delivered to the meter you confirmed, it cannot be moved to a different meter. If the account name does not match, stop and check the number.",
        ],
      },
    ],
  },
  {
    slug: "how-to-buy-jamb-and-waec-exam-pins-online",
    title: "How to buy JAMB and WAEC exam PINs online",
    description: "Buy exam PINs for JAMB and WAEC from your phone in naira, and check your details before you pay.",
    date: "2026-11-17",
    sections: [
      {
        heading: "Before you start",
        paras: [
          "Check which exam and year you are registering for, and make sure you have the details the exam body asks for. Look at the exam body's own instructions if you are unsure.",
        ],
      },
      {
        heading: "Steps",
        paras: [
          "Open the exams page on nolgic.com and choose the exam you need.",
          "Enter the details requested on the page. Check them carefully, because a PIN that has been delivered cannot be reversed.",
          "Review the total, which includes a small service fee shown on its own line, and pay in naira.",
        ],
      },
      {
        heading: "If you need help",
        paras: [
          "If something on your order looks wrong, contact us before you use the PIN. Our refund policy explains what happens if a delivery fails.",
        ],
      },
    ],
  },
  {
    slug: "what-to-do-if-a-bill-payment-fails",
    title: "What to do if a bill payment fails on Nolgic",
    description: "What happens to your money if a bill payment does not go through, and how to get help quickly.",
    date: "2026-11-17",
    sections: [
      {
        heading: "What happens to your money",
        paras: [
          "If delivery fails for any reason, Nolgic refunds you in full to the card or account you paid with. The refund is automatic and does not need a request from you.",
          "Banks can take a few working days to show the refund on your statement. The timing depends on your bank.",
        ],
      },
      {
        heading: "When to contact us",
        paras: [
          "If a payment is still showing as pending after a while, or you were charged but have no confirmation, contact us with the order details. Keep your payment receipt.",
          "If you believe a bill was delivered to the wrong number despite showing the correct account name, contact us within 48 hours so we can investigate with the provider.",
        ],
      },
    ],
  },
  {
    slug: "is-it-safe-to-pay-bills-online-nigeria",
    title: "Is it safe to pay bills online in Nigeria?",
    description: "How to check a bill payment site before you pay: the account name, the total, the refund rule and the receipt.",
    date: "2026-11-18",
    sections: [
      {
        heading: "Short answer",
        paras: [
          "Paying a bill online is safe when the site shows you who the payment is for before you pay, makes the total clear, and says what happens if delivery fails. Check those three things every time.",
        ],
      },
      {
        heading: "Check the account name first",
        paras: [
          "Before any money moves, the meter, smartcard or phone number should come back with a name. On nolgic.com you see that name and confirm it is the right person or household.",
          "If the name is not the one you expect, stop and check the number. A mistyped meter or smartcard number is the most common reason a bill goes to the wrong place.",
        ],
      },
      {
        heading: "Check the total",
        paras: [
          "The total you see before you pay should be everything you pay. On Nolgic the service fee is shown on its own line, so you know what the bill costs and what the service costs.",
        ],
      },
      {
        heading: "Check what happens if it fails",
        paras: [
          "Look for a clear refund rule. On Nolgic, if the provider rejects the payment or delivery fails, we refund you in full to the card or account you paid with. You do not need to ask for it.",
          "Refunds show on your statement after your bank processes them, which can take a few working days.",
        ],
      },
      {
        heading: "Keep your receipt",
        paras: [
          "After you pay, keep the receipt or order number. If you are charged but have no confirmation, contact us with the order number so we can look it up.",
        ],
      },
      {
        heading: "Your card details",
        paras: [
          "Card payments happen on the secure payment page of our payment provider. Your card details never reach Nolgic.",
        ],
      },
    ],
  },
  {
    slug: "pay-bills-online-in-nigeria-from-any-state",
    title: "Pay bills online in Nigeria from any state, or from abroad",
    description: "Pay for DStv, airtime, data, electricity and exam PINs in naira from wherever you live in Nigeria, or send a bill link to family from abroad.",
    date: "2026-11-21",
    sections: [
      {
        heading: "Pay from your phone, wherever you are",
        paras: [
          "You do not need to travel to a shop or agent to pay a bill. Nolgic runs in your phone's browser, so you can pay from home, at work or in another city.",
          "Pay with your card in naira on the secure payment page. Your card details never reach Nolgic.",
        ],
      },
      {
        heading: "What you can pay for",
        paras: [
          "You can pay a DStv subscription, buy airtime or data for MTN, Glo, Airtel or 9mobile, pay your electricity bill, and buy JAMB and WAEC exam PINs. Each guide on this blog walks through one of these.",
          "Read the guide for the bill you are paying before you start, because each one asks for a different number: a smartcard or IUC number, a phone number or a meter number.",
        ],
      },
      {
        heading: "Check the name before you pay",
        paras: [
          "For DStv and electricity, Nolgic shows the account name linked to the number you enter. Check that it is yours before you continue.",
          "Airtime and data have no account-name check, so double-check the phone number. A delivered top-up cannot be reversed.",
        ],
      },
      {
        heading: "Pay for family from abroad",
        paras: [
          "If you live outside Nigeria and want to pay a bill for a relative at home, they can create a Pay for Me request on nolgic.com listing the bills to be paid. They send you the link, and you pay it from wherever you are.",
          "Read the full guide on paying a bill for someone in Nigeria from abroad before you send the link.",
        ],
      },
      {
        heading: "If a payment does not go through",
        paras: [
          "If a payment fails, Nolgic refunds you as described in our refund policy. Read what to do if a bill payment fails for the steps to take and when to contact us.",
        ],
      },
    ],
  },
];

export const getPost = (slug: string) => posts.find((p) => p.slug === slug);
