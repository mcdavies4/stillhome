# Bills provider failover

Nolgic can send a paid order through a second bills provider when the first one can't deliver it.
It is off until you set one variable.

## Turn it on

In Vercel (Production), set:

    BILLS_FAILOVER_PROVIDER=vtpass      (or paybeta, or flutterwave)

It must differ from `BILLS_PROVIDER` and that provider's keys must be set. Otherwise nothing changes.

## When it happens

Only in two cases, both of which mean nothing was bought:

1. The primary wallet can't fund the vend. The customer was never charged for a failed vend.
2. The primary provider rejects the purchase request straight away (a "not bought" answer).

It never happens on a timeout, a 5xx, or an unclear answer. In those cases the primary may still
deliver, so the order goes to the normal requery and review path. Sending a second vend then could
deliver twice.

## What has to match

The backup must list the same product: the same network for airtime, or the same biller name and,
for fixed-price plans, the same price. Names are matched with spaces and punctuation removed, and
"Airtime", "VTU", "Top up" and "Recharge" are ignored for airtime. If exactly one product matches,
the order goes ahead. If there is no match, or two, the order is refunded as before. Electricity and
cable meters are checked on the backup first.

## Checkout

A single order's "can we deliver this?" check counts both wallets. Bulk airtime and exam PINs still
check only the primary wallet, so they never rely on the backup.

## Alerts

Each failover sends one email titled "Order moved to backup provider". Refunds, reviews and
low-wallet alerts work as before.

## Check after switching on

Place a small airtime order while the primary wallet is low or the primary is set to reject, then confirm:
- the order reaches `fulfilled`, with a token or receipt;
- the `flw_reference` on the order starts with the backup's prefix (`PB` for Paybeta, a 12-digit id for VTpass);
- the founder email arrived.
