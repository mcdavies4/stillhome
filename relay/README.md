# Nolgic fixed-IP relay

Flutterwave and VTpass accept live API calls only from whitelisted server IPs. Vercel has no fixed IP.
This tiny service runs on a small VPS (which has a permanent IPv4) and forwards Nolgic's provider calls.
Whitelist the VPS IP once; Nolgic sends everything through it.

Nolgic ──https + RELAY_KEY──▶ relay (fixed IP) ──▶ vtpass.com / api.flutterwave.com

## Set up (about 20 minutes)

1. Rent the smallest Ubuntu 24.04 VPS in London/EU (Hetzner, DigitalOcean, Vultr — roughly £4–6/month).
   Note its IPv4 address.
2. At your DNS provider for nolgic.com add an **A record**: `relay` → that IPv4 address. Wait a few minutes.
3. From PowerShell in the repo folder:
   ```powershell
   scp relay\server.js relay\setup.sh root@<VPS_IP>:/root/
   ssh root@<VPS_IP> "bash /root/setup.sh relay.nolgic.com"
   ```
   It prints the IP to whitelist, the two base URLs and your `RELAY_KEY`.
4. Whitelist that IP in the Flutterwave dashboard and with VTpass.
5. In Vercel → Environment Variables (Production), add, then redeploy:
   ```
   RELAY_KEY=<printed key>
   VTPASS_BASE=https://relay.nolgic.com/vtpass
   FLW_BASE=https://relay.nolgic.com/flutterwave
   ```
6. Check: `curl.exe --ssl-no-revoke https://relay.nolgic.com/healthz` → `{"ok":true}`
   and `curl.exe --ssl-no-revoke -H "x-relay-key: <key>" https://relay.nolgic.com/whoami` → the IP providers see.
   It must match the IP you whitelisted.

## Rules it enforces
Needs the secret on every request · forwards only to vtpass.com, sandbox.vtpass.com and api.flutterwave.com ·
GET/POST only · 100 KB body cap · never logs bodies, headers or query strings · stores no provider keys.

## Operating it
- Logs: `journalctl -u nolgic-relay -f`
- Restart: `systemctl restart nolgic-relay`
- Rotate the key: re-run `setup.sh relay.nolgic.com <new-key>` and update `RELAY_KEY` in Vercel.
- It is a single point of failure: if the VPS is down, bill payments fail (customers are auto-refunded).
  Turn on your provider's snapshot/monitoring, and keep Vercel env vars so you can remove `*_BASE` to go direct.
