#!/usr/bin/env bash
# One-shot setup for the Nolgic fixed-IP relay on a fresh Ubuntu 22.04/24.04 VPS.
#   scp relay/server.js relay/setup.sh root@<VPS_IP>:/root/
#   ssh root@<VPS_IP> "bash /root/setup.sh relay.yourdomain.com"
# Point the DNS A record for that name at the VPS IP BEFORE running (Caddy needs it to get HTTPS).
set -euo pipefail

DOMAIN="${1:?usage: setup.sh relay.yourdomain.com [existing-relay-key]}"
KEY="${2:-}"
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
[ -f /root/server.js ] || { echo "/root/server.js not found - scp it first"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ufw gnupg debian-keyring debian-archive-keyring apt-transport-https ca-certificates openssl

# Node 20
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Caddy (automatic HTTPS)
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Relay service (runs as an unprivileged user, listens on localhost only)
id relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin relay
install -d -o root -g root /opt/nolgic-relay
install -m 0644 /root/server.js /opt/nolgic-relay/server.js

if [ -z "$KEY" ]; then
  if [ -f /etc/nolgic-relay.env ]; then KEY="$(grep '^RELAY_KEY=' /etc/nolgic-relay.env | cut -d= -f2-)"; fi
  [ -n "$KEY" ] || KEY="$(openssl rand -hex 32)"
fi
umask 077
printf 'RELAY_KEY=%s\nPORT=8787\nHOST=127.0.0.1\n' "$KEY" > /etc/nolgic-relay.env
chown root:relay /etc/nolgic-relay.env && chmod 640 /etc/nolgic-relay.env

cat > /etc/systemd/system/nolgic-relay.service <<UNIT
[Unit]
Description=Nolgic fixed-IP relay
After=network-online.target
Wants=network-online.target

[Service]
User=relay
EnvironmentFile=/etc/nolgic-relay.env
ExecStart=/usr/bin/node /opt/nolgic-relay/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
	reverse_proxy 127.0.0.1:8787
}
CADDY

# Firewall: SSH + web only
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now nolgic-relay
systemctl restart caddy
sleep 3

IPV4="$(curl -4 -fsS https://api.ipify.org || echo '?')"
echo
echo "=================================================="
echo " Relay is up."
echo " Whitelist this IP at Flutterwave / VTpass: ${IPV4}"
echo " VTPASS_BASE=https://${DOMAIN}/vtpass"
echo " FLW_BASE=https://${DOMAIN}/flutterwave"
echo " RELAY_KEY=${KEY}"
echo " (keep RELAY_KEY secret: Vercel env vars only)"
echo "=================================================="
echo "Test:  curl https://${DOMAIN}/healthz"
