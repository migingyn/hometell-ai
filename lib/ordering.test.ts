import { test } from "node:test";
import assert from "node:assert/strict";
import { sortClientsForEvent } from "./ordering";
import type { Client } from "./types";

const client = (name: string, tier: Client["risk_tier"], ride: boolean, alone: boolean) => ({ name, risk_tier: tier, needs_ride: ride, lives_alone: alone } as Client);
test("crisis prioritizes risk, then ride need, then living alone without mutating the roster", () => {
  const roster = [client("green", "green", true, true), client("red other", "red", false, false), client("red alone", "red", false, true), client("red ride", "red", true, false)];
  assert.deepEqual(sortClientsForEvent(roster, "crisis").map((c) => c.name), ["red ride", "red alone", "red other", "green"]);
  assert.equal(roster[0].name, "green");
});
test("daily includes every client without promoting ride needs within a tier", () => {
  const roster = [client("Z", "red", true, true), client("A", "red", false, false), client("B", "yellow", false, false)];
  assert.deepEqual(sortClientsForEvent(roster, "daily").map((c) => c.name), ["A", "Z", "B"]);
});
