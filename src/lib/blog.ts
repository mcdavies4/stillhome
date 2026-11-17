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
];

export const getPost = (slug: string) => posts.find((p) => p.slug === slug);
