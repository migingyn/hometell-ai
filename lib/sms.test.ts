import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { config } from "./config";
import { sendSms } from "./sms";

const originalFetch = globalThis.fetch;
const originalMock = config.mockRetell;
const names = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;
const oldEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const sid = `AC${"1".repeat(32)}`;
beforeEach(() => {
  config.mockRetell = false;
  process.env.TWILIO_ACCOUNT_SID = sid;
  process.env.TWILIO_AUTH_TOKEN = "test-only-token";
  process.env.TWILIO_FROM_NUMBER = "+15555550101";
});
afterEach(() => {
  config.mockRetell = originalMock;
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name];
  }
});

test("sends Twilio's authenticated form request and labels acceptance without claiming delivery", async () => {
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Basic ${Buffer.from(`${sid}:test-only-token`).toString("base64")}`);
    assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("To"), "+15555550102");
    assert.equal(body.get("From"), "+15555550101");
    assert.equal(body.get("Body"), "We missed you. Call the agency.");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ sid: "SM_test_message", status: "queued" }, { status: 201 });
  };
  const result = await sendSms("+15555550102", "We missed you. Call the agency.");
  assert.equal(requests, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.id, "SM_test_message");
  assert.match(result.note, /delivery not confirmed/);
});

test("missing configuration never sends a message and supplies the dashboard label", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Must not send"); };
  for (const name of names) {
    const value = process.env[name];
    delete process.env[name];
    const result = await sendSms("+15555550102", "A check-in message");
    assert.equal(result.status, "not_configured");
    assert.equal(result.note, "text not sent (SMS not configured)");
    process.env[name] = value;
  }
  assert.equal((await sendSms("", "A message")).status, "not_configured");
  assert.equal(requests, 0);
});

test("mock mode logs explicitly and never uses the network", async (t) => {
  config.mockRetell = true;
  const log = t.mock.method(console, "log", () => undefined);
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Must not send"); };
  const result = await sendSms("+15555550102", "A mocked check-in message");
  assert.equal(result.status, "mock");
  assert.match(result.id!, /^mock_sms_/);
  assert.match(result.note, /no message sent/);
  assert.match(log.mock.calls[0].arguments[0], /sms:mock/);
  assert.equal(requests, 0);
});

test("provider failures, malformed payloads, and network uncertainty are safe dashboard results", async () => {
  for (const response of [
    new Response("private-token +15555550102", { status: 401 }),
    Response.json({ sid: "SM_failed", status: "failed" }),
    Response.json({ status: "queued" }),
    new Response("not-json", { status: 201 }),
  ]) {
    globalThis.fetch = async () => response;
    const result = await sendSms("+15555550102", "A check-in message");
    assert.equal(result.status, "failed");
    assert.doesNotMatch(JSON.stringify(result), /private-token|15555550102|test-only-token/);
  }
  globalThis.fetch = async () => { throw new Error("test-only-token"); };
  const uncertain = await sendSms("+15555550102", "A check-in message");
  assert.equal(uncertain.status, "failed");
  assert.match(uncertain.note, /unknown/);
});

test("invalid telephone numbers and oversized messages fail before HTTP", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Must not send"); };
  for (const to of ["911", "555-1234", "+0"]) assert.equal((await sendSms(to, "A message")).status, "failed");
  assert.equal((await sendSms("+15555550102", "x".repeat(1601))).status, "failed");
  assert.equal(requests, 0);
});
