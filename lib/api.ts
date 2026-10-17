import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/types";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiResult<T>>({ ok: true, data }, { status });
}

export function fail(error: string, status = 400) {
  return NextResponse.json<ApiResult<never>>({ ok: false, error }, { status });
}
