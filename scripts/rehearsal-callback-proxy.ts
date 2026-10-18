import "./env";
import { createServer } from "node:http";
import Retell from "retell-sdk";

// The tunnel targets this restricted server, never the application itself.
// Only authenticated provider callbacks are forwarded. The dashboard, records,
// recording bytes, and call-start API remain local.
const target = new URL(process.env.HEARTBEAT_REHEARSAL_APP_URL || "http://127.0.0.1:3018");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.protocol !== "http:") throw new Error("Callback target must be local HTTP");
const port = Number(process.env.HEARTBEAT_REHEARSAL_PROXY_PORT || 3020);
const apiKey = process.env.RETELL_API_KEY;
if (!apiKey) throw new Error("RETELL_API_KEY is required");
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"service":"heartbeat-callback","ready":true}'); return; }
  if (req.method !== "POST" || req.url !== "/api/retell/webhook") { res.writeHead(404); res.end(); return; }
  const signature = req.headers["x-retell-signature"];
  if (typeof signature !== "string") { res.writeHead(401); res.end(); return; }
  try {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) { const bytes = Buffer.from(chunk); length += bytes.length; if (length > 1_000_000) { res.writeHead(413); res.end(); return; } chunks.push(bytes); }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!await Retell.verify(raw, apiKey, signature)) { res.writeHead(401); res.end(); return; }
    const response = await fetch(new URL("/api/retell/webhook", target), { method: "POST", headers: { "Content-Type": "application/json", "x-retell-signature": signature }, body: raw, signal: AbortSignal.timeout(8_000), redirect: "error" });
    // Never expose application response bodies to the tunnel.
    res.writeHead(response.ok ? 204 : response.status); res.end();
  } catch { res.writeHead(502); res.end(); }
});
server.requestTimeout = 10_000;
server.listen(port, "127.0.0.1", () => console.log(`Restricted callback ingress listening on 127.0.0.1:${port}`));
