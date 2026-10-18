// Response helpers. The contract in API.md: data as plain JSON, errors as { error }.
import { NextResponse } from "next/server";
import { z } from "zod";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// Parses a JSON body with zod. Returns the data, or a 400 response to send back.
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return { error: fail(z.prettifyError(parsed.error)) };
  return { data: parsed.data };
}

// Parses a numeric route param like /api/clients/3.
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Wraps a handler so a thrown error becomes { error } with status 500.
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api]", message);
    return fail(message, 500);
  }
}
