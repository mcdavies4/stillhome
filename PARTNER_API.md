# Nolgic Partner API

Pay Nigerian utility bills programmatically. You hold a prepaid GBP wallet
with Nolgic; every vend debits it. Failed vends are automatically credited
back — you carry no card or chargeback risk.

Base URL: `https://www.nolgic.com/api/v1`

## Authentication

Every request needs your API key:

```
Authorization: Bearer nolgic_live_xxxxxxxxxxxx
```

Test keys (`nolgic_test_...`) exercise the full flow — pricing, wallet debit,
idempotency, webhooks — but simulate the utility vend instead of delivering
a real token.

## 1. Validate an identifier

`POST /validate`

```json
{ "biller_code": "BIL119", "item_code": "AT099", "identifier": "45023018921" }
```

Response `200`:

```json
{ "valid": true, "customer_name": "ADAEZE OKAFOR", "identifier": "45023018921" }
```

Always validate before vending — it's how you avoid wrong-meter support tickets.

## 2. Get a quote

`POST /quote`

```json
{ "amount_ngn": 10000 }
```

Response:

```json
{
  "amount_ngn": 10000,
  "fx_ngn_per_gbp": 1830.00,
  "base_gbp_pence": 547,
  "fee_pence": 30,
  "total_gbp_pence": 577
}
```

Quotes are informational; the rate applied is the rate at vend time.

## 3. Vend

`POST /vend`

```json
{
  "partner_ref": "your-unique-id-123",
  "biller_code": "BIL119",
  "item_code": "AT099",
  "biller_name": "Ikeja Electric Prepaid",
  "identifier": "45023018921",
  "identifier_label": "Meter number",
  "amount_ngn": 10000,
  "customer_name": "ADAEZE OKAFOR",
  "recipient_whatsapp": "+2348012345678"
}
```

`partner_ref` is your idempotency key: retries with the same value return the
original order and never double-charge.

Responses:

- `200` — `order.status: "fulfilled"`, `order.token` contains the electricity
  token (where applicable).
- `202` — vend submitted but final status pending; poll `GET /orders/{id}`.
- `402 insufficient_funds` — top up your wallet.
- `422` — vend failed at the provider; your wallet was automatically
  refunded (`status: "failed_refunded"`).
- `429 daily_cap_reached` — daily spending cap hit; contact us to raise it.

## 4. Poll an order

`GET /orders/{id}` → `{ "order": { "status": "...", "token": "...", ... } }`

Statuses: `paid` (vend in flight) → `fulfilled` | `failed_refunded`.

## Webhooks

Configure a webhook URL with us and we'll POST events:

| Event | Meaning |
|---|---|
| `vend.success` | Token delivered; payload includes it |
| `vend.failed` | Provider rejected the vend |
| `vend.refunded` | Wallet credited back |

Every request carries `X-Nolgic-Signature`: HMAC-SHA256 of the raw body using
your webhook secret. Verify like this (Node):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, signature, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Respond `2xx` within 10 seconds; we retry with backoff for up to 8 attempts.

## Wallet

Top-ups are currently by GBP bank transfer — contact us and we credit your
wallet the same day. Your ledger and balance are available on request
(dashboard coming).

## Quick demo (test key)

```bash
curl -X POST https://www.nolgic.com/api/v1/vend \
  -H "Authorization: Bearer nolgic_test_YOURKEY" \
  -H "Content-Type: application/json" \
  -d '{
    "partner_ref": "demo-001",
    "biller_code": "BIL119",
    "item_code": "AT099",
    "biller_name": "Ikeja Electric Prepaid",
    "identifier": "45023018921",
    "identifier_label": "Meter number",
    "amount_ngn": 5000
  }'
```

Run it twice — the second call returns the same order (`idempotent_replay: true`).
That's the safety guarantee your retries rely on.
