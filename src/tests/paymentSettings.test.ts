import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYMENT_SETTINGS_REVISION,
  nextPaymentSettingsBackfill,
} from "../services/payment-settings.service";

test("backfill turns Bachs on for settings created before the key existed", () => {
  const patch = nextPaymentSettingsBackfill({
    bachsEnabled: false,
    settingsRevision: 0,
  });
  assert.deepEqual(patch, {
    bachsEnabled: true,
    aellaEnabled: true,
    settingsRevision: PAYMENT_SETTINGS_REVISION,
  });
});

test("backfill turns Aella on without resetting a later Bachs disable", () => {
  assert.deepEqual(
    nextPaymentSettingsBackfill({
      bachsEnabled: false,
      settingsRevision: 1,
    }),
    {
      bachsEnabled: false,
      aellaEnabled: true,
      settingsRevision: PAYMENT_SETTINGS_REVISION,
    },
  );
});

test("backfill does not override an admin disable after it has run", () => {
  assert.equal(
    nextPaymentSettingsBackfill({
      bachsEnabled: false,
      aellaEnabled: false,
      settingsRevision: PAYMENT_SETTINGS_REVISION,
    }),
    null,
  );
});
