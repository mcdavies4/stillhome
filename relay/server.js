"use strict";
// Nolgic fixed-IP relay.
//
// Why: Flutterwave / VTpass only accept live API calls from whitelisted server IPs,
// and Vercel has no fixed IP. Run this on a small VPS (it has one permanent IPv4),
// whitelist that IP, and point Nolgic at it:
//     VTPASS_BASE=https://relay.yourdomain.com/vtpass
//     FLW_BASE=https://relay.yourdomain.com/flutterwave
//     PAYBETA_BASE=https://relay.yourdomain.com/paybeta   (only if Paybeta asks for a whitelisted IP)
//     RELAY_KEY=<the secret setup.sh printed>
//
// It is NOT an open proxy:
//   * every request needs the x-relay-key secret (constant-time compare)
//   * it only forwards to the exact hosts/paths in ROUTES below
//   * only GET/POST, only a fixed set of headers, bodies capped at 100 KB
//   * provider keys are NOT stored here — Nolgic sends them per request
//   * request bodies, headers and query strings are never logged
// Zero dependencies. Node 18+.

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

const DEFAULT_ROUTES = {
  "/vtpass/": "https://vtpass.com/api/",
  "/vtpass-sandbox/": "https://sandbox.vtpass.com/api/",
  "/flutterwave/": "https://api.flutterwave.com/v3/",
  "/paybeta/": "https://api.paybeta.ng/",
  "/paybeta-sandbox/": "https://api.sandbox.paybeta.ng/",
};
const FORWARD_HEADERS = ["authorization", "api-key", "public-key", "secret-key", "p-api-key", "content-type", "accept"];
const MAX_BODY = 100 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30000;

function digest(x) { return crypto.createHash("sha256").update(String(x)).digest(); }
function safeEqual(a, b) { return crypto.timingSafeEqual(digest(a), digest(b)); }

function createRelay(opts) {
  const key = String(opts.key || "");
  if (key.length < 32) throw new Error("RELAY_KEY must be at least 32 characters");
  const routes = opts.routes || DEFAULT_ROUTES;
  const log = opts.log || ((line) => console.log(line));
  const egressCheck = opts.egressCheck !== false;

  // tiny in-memory rate limiting: failed auths per source, and total requests per minute
  const fails = new Map();
  let windowStart = Date.now();
  let total = 0;
  const MAX_FAILS = 20, MAX_TOTAL = 600;

  function roll() {
    const now = Date.now();
    if (now - windowStart > 60000) { windowStart = now; total = 0; fails.clear(); }
  }

  // Behind Caddy every socket is 127.0.0.1, so use the client address Caddy appends (rightmost
  // X-Forwarded-For entry) — but only trust that header when the socket itself is loopback.
  function clientIp(req) {
    const remote = req.socket.remoteAddress || "?";
    if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") {
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return remote;
  }

  function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
    res.end(body);
  }

  function resolveTarget(rawUrl) {
    const prefixes = Object.keys(routes);
    for (let i = 0; i < prefixes.length; i++) {
      const p = prefixes[i];
      if (rawUrl.indexOf(p) !== 0) continue;
      const rest = rawUrl.slice(p.length);
      if (!rest || rest.charAt(0) === "/" || rest.indexOf("@") !== -1 || rest.indexOf("\\") !== -1) return null;
      let base, u;
      try { base = new URL(routes[p]); u = new URL(routes[p] + rest); } catch (e) { return null; }
      if (u.protocol !== base.protocol || u.host !== base.host || u.pathname.indexOf(base.pathname) !== 0) return null;
      return { prefix: p, url: u };
    }
    return null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0; let tooBig = false;
      req.on("data", (c) => {
        if (tooBig) return; // discard the rest; we answer 413 and close the connection
        size += c.length;
        if (size > MAX_BODY) { tooBig = true; reject(Object.assign(new Error("too large"), { code: 413 })); return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  function whoami(res) {
    // Which IPv4 do upstream providers see? Use this to confirm the address you whitelist.
    const r = https.request({ hostname: "api.ipify.org", path: "/", method: "GET", family: 4, timeout: 8000 }, (up) => {
      let b = ""; up.on("data", (d) => (b += d)); up.on("end", () => send(res, 200, { egress_ipv4: b.trim() }));
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", () => send(res, 502, { error: "egress_check_failed" }));
    r.end();
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const ip = clientIp(req);
    let tag = "-";
    try {
      if (req.url === "/healthz") return send(res, 200, { ok: true });

      roll();
      if (total >= MAX_TOTAL) return send(res, 429, { error: "slow_down" });
      total++;
      if (!safeEqual(req.headers["x-relay-key"] || "", key)) {
        // Wrong key: throttle that source. A correct key is never locked out by someone else's guesses.
        const n = (fails.get(ip) || 0) + 1;
        fails.set(ip, n);
        log(`${new Date().toISOString()} ${n > MAX_FAILS ? 429 : 401} auth`);
        return send(res, n > MAX_FAILS ? 429 : 401, { error: n > MAX_FAILS ? "slow_down" : "unauthorized" });
      }
      if (req.url === "/whoami" && egressCheck) return whoami(res);
      if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

      const target = resolveTarget(req.url || "");
      if (!target) return send(res, 404, { error: "not_found" });
      tag = target.prefix;

      const body = req.method === "POST" ? await readBody(req) : null;
      const headers = {};
      FORWARD_HEADERS.forEach((h) => { if (req.headers[h]) headers[h] = req.headers[h]; });
      if (body && body.length) headers["content-length"] = String(body.length);

      const lib = target.url.protocol === "https:" ? https : http;
      const up = lib.request({
        method: req.method, hostname: target.url.hostname, port: target.url.port || undefined,
        path: target.url.pathname + target.url.search, headers: headers,
        family: 4, // providers whitelist the IPv4 address
        timeout: UPSTREAM_TIMEOUT_MS,
      }, (ur) => {
        const chunks = []; let size = 0; let aborted = false;
        ur.on("data", (c) => {
          size += c.length;
          if (size > MAX_RESPONSE) { aborted = true; ur.destroy(); return; }
          chunks.push(c);
        });
        ur.on("end", () => {
          if (aborted) return send(res, 502, { error: "response_too_large" });
          const out = Buffer.concat(chunks);
          res.writeHead(ur.statusCode || 502, {
            "content-type": ur.headers["content-type"] || "application/json",
            "content-length": out.length, "cache-control": "no-store",
          });
          res.end(out);
          log(`${new Date().toISOString()} ${req.method} ${tag} ${ur.statusCode} ${Date.now() - started}ms`);
        });
        ur.on("error", () => send(res, 502, { error: "upstream_error" }));
      });
      up.on("timeout", () => up.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
      up.on("error", (e) => {
        log(`${new Date().toISOString()} ${req.method} ${tag} upstream-${e.code || "error"} ${Date.now() - started}ms`);
        if (!res.headersSent) send(res, e.code === "ETIMEDOUT" ? 504 : 502, { error: e.code === "ETIMEDOUT" ? "upstream_timeout" : "upstream_unreachable" });
      });
      if (body && body.length) up.write(body);
      up.end();
    } catch (e) {
      if (e && e.code === 413) {
        res.once("finish", () => req.destroy());
        res.setHeader("connection", "close");
        return send(res, 413, { error: "too_large" });
      }
      if (!res.headersSent) send(res, 500, { error: "relay_error" });
    }
  });
}

module.exports = { createRelay, DEFAULT_ROUTES };

if (require.main === module) {
  const key = process.env.RELAY_KEY || "";
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1"; // Caddy terminates TLS in front of this
  let server;
  try { server = createRelay({ key }); } catch (e) { console.error(String(e.message)); process.exit(1); }
  server.listen(port, host, () => console.log(`nolgic-relay listening on ${host}:${port}`));
}
