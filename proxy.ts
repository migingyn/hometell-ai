// CORS for the separate frontend at FRONTEND_ORIGIN. Only /api routes; Retell routes do not need it.
import { NextResponse, type NextRequest } from "next/server";

const ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

export function proxy(req: NextRequest) {
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: CORS });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
