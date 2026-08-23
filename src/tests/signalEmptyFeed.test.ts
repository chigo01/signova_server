import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyApprovedSignalsPayload,
  isEmptyAdminSignalsError,
} from "../services/signal.service";

test("admin 404s for an empty vault day are not fetch failures", () => {
  assert.equal(
    isEmptyAdminSignalsError(
      404,
      JSON.stringify({ success: false, error: "No elite signals found" }),
    ),
    true,
  );
  assert.equal(
    isEmptyAdminSignalsError(
      404,
      JSON.stringify({ error: "No signals found for today" }),
    ),
    true,
  );
  assert.equal(
    isEmptyAdminSignalsError(500, JSON.stringify({ error: "boom" })),
    false,
  );
  assert.equal(isEmptyAdminSignalsError(404, "not found"), false);
});

test("empty feed payload is a 200-shaped approved-signals body", () => {
  assert.deepEqual(emptyApprovedSignalsPayload(), {
    success: true,
    signals: [],
    eliteTrades: [],
    count: 0,
    totalEliteTrades: 0,
  });
});
