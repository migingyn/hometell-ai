// Runs before every /api route.
// 1. Keeps /api off the public tunnel. ngrok forwards with its own Host header, so a request
//    that did not come to localhost came from the internet. Retell only needs /retell-webhook
//    and /retell/functions/*, which are outside /api and check signatures. Set PUBLIC_API=true
//    if a hosted frontend must reach /api through the public URL.
// 2. CORS for the separate frontend at FRONTEND_ORIGIN.
import { NextResponse, type NextRequest } from "next/server";

const ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// The Host the client asked for, without the port. req.nextUrl.hostname is not used: Next dev
// reports localhost there even for tunneled requests.
function requestHost(req: NextRequest): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  return host.replace(/:\d+$/, "");
}

export function proxy(req: NextRequest) {
  if (process.env.PUBLIC_API !== "true" && !LOCAL_HOSTS.has(requestHost(req))) {
    return NextResponse.json({ error: "The API is only open on localhost. Set PUBLIC_API=true to allow it here." }, { status: 403, headers: CORS });
  }
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: CORS });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
