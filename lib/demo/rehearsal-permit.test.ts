import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalPresenter, issueRehearsalPermit, normalizeTestPhone, verifyRehearsalPermit } from "./rehearsal-permit";

const key = "local-test-key-with-at-least-24-characters";
const input = { sessionId: "11111111-1111-4111-a111-111111111111", eventId: "22222222-2222-4222-a222-222222222222", checkId: "33333333-3333-4333-a333-333333333333", requestId: "44444444-4444-4444-a444-444444444444", confirmed: true as const };
const now = 1_000_000;
function permit() { const { confirmed: _, ...binding } = input; void _; return issueRehearsalPermit({ ...binding, phone: "(202) 555-0199" }, key, now).permit; }

test("test number normalization accepts US and international formats and rejects invalid destinations", () => {
  assert.equal(normalizeTestPhone("(202) 555-0199"), "+12025550199");
  assert.equal(normalizeTestPhone("1-202-555-0199"), "+12025550199");
  assert.equal(normalizeTestPhone("+44 20 7946 0123"), "+442079460123");
  for (const value of ["911", "", "+", "call me", "2025550199;911"]) assert.throws(() => normalizeTestPhone(value));
});

test("keyless preparation accepts local same-origin browser requests only", () => {
  const request = (url: string, origin?: string, extra: Record<string,string> = {}) => new Request(url, { headers: { ...(origin ? { origin } : {}), ...extra } });
  assert.doesNotThrow(() => assertLocalPresenter(request("http://127.0.0.1:3018/api/demo/rehearsal/prepare", "http://127.0.0.1:3018", { "sec-fetch-site": "same-origin" })));
  for (const req of [request("http://127.0.0.1:3018/"), request("http://127.0.0.1:3018/", "https://evil.example"), request("http://127.0.0.1:3018/", "http://127.0.0.1:4000"), request("https://example.com/", "https://example.com"), request("http://127.0.0.1:3018/", "http://127.0.0.1:3018", { "x-forwarded-host": "remote.example" }), request("http://127.0.0.1:3018/", "http://127.0.0.1:3018", { "sec-fetch-site": "cross-site" })]) assert.throws(() => assertLocalPresenter(req));
});

test("prepared authorization binds the recipient, person, event, session, and idempotent request", () => {
  const token = permit();
  assert.equal(verifyRehearsalPermit(token, input, key, now + 1), "+12025550199");
  for (const field of ["sessionId", "eventId", "checkId", "requestId"] as const) assert.throws(() => verifyRehearsalPermit(token, { ...input, [field]: "55555555-5555-4555-a555-555555555555" }, key, now + 1));
  const [payload, signature] = token.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
  changed.phone = "+12025550100";
  assert.throws(() => verifyRehearsalPermit(`${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`, input, key, now + 1));
  assert.throws(() => verifyRehearsalPermit(token, input, "another-private-key-at-least-24", now + 1));
});

test("prepared authorization expires and never exposes the server signing key", () => {
  assert.throws(() => verifyRehearsalPermit(permit(), input, key, now + 15 * 60_000));
  assert.throws(() => verifyRehearsalPermit(permit(), input, key, now - 1));
  assert.doesNotMatch(permit(), new RegExp(key));
});
