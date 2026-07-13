// src/components/WhatsAppBubble.tsx
// Floating "pay on WhatsApp" bubble — deep-links into the Nolgic bot with a
// prefilled first message so the chat starts itself.

const WA_LINK =
  "https://wa.me/447459233682?text=" +
  encodeURIComponent("Hi Nolgic! I'd like to pay a bill");

export default function WhatsAppBubble() {
  return (
    <a
      href={WA_LINK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Pay a bill on WhatsApp"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 50,
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#25D366",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      }}
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true">
        <path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.5c1.2.6 2.5.9 3.8.9 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 22c-1.2 0-2.4-.3-3.5-.8l-.5-.3-4.9.9.9-4.7-.3-.5C6.6 18.1 6 16.6 6 15c0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10zm5.5-7.5c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.2s-.8 1-.9 1.2c-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.6c0-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4S9 11.2 9 12.7s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4z" />
      </svg>
    </a>
  );
}
