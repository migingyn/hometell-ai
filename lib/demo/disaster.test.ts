import test from "node:test";
import assert from "node:assert/strict";
import { config } from "@/lib/config";
import { assertLocalDemo } from "./disaster";

test("simulation guard rejects real calling and nonlocal databases before any work", () => {
  const mock = config.mockRetell;
  const envMock = process.env.MOCK_RETELL;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    config.mockRetell = true;
    process.env.MOCK_RETELL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:55321";
    assert.doesNotThrow(assertLocalDemo);
    config.mockRetell = false;
    assert.throws(assertLocalDemo, /requires MOCK_RETELL/);
    config.mockRetell = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://real-project.supabase.co";
    assert.throws(assertLocalDemo, /local Supabase/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://user:password@localhost:55321";
    assert.throws(assertLocalDemo, /local Supabase/);
  } finally {
    config.mockRetell = mock;
    if (envMock === undefined) delete process.env.MOCK_RETELL; else process.env.MOCK_RETELL = envMock;
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  }
});
