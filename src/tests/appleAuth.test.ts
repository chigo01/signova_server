import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AppleAuthService } from "../services/apple-auth.service";
import { AppError } from "../middleware/errorHandler";

const CLIENT_ID = "com.signova.signova";
const RAW_NONCE = "secure-random-nonce";
const HASHED_NONCE = crypto
  .createHash("sha256")
  .update(RAW_NONCE)
  .digest("hex");

test("buildIdentity returns a verified Apple identity", () => {
  const identity = AppleAuthService.buildIdentity(
    {
      aud: CLIENT_ID,
      sub: "apple-user-1",
      email: "USER@privaterelay.appleid.com",
      email_verified: "true",
      nonce: HASHED_NONCE,
    },
    RAW_NONCE,
    [CLIENT_ID]
  );

  assert.deepEqual(identity, {
    appleId: "apple-user-1",
    email: "user@privaterelay.appleid.com",
    clientId: CLIENT_ID,
  });
});

test("buildIdentity rejects a replayed nonce", () => {
  assert.throws(
    () =>
      AppleAuthService.buildIdentity(
        {
          aud: CLIENT_ID,
          sub: "apple-user-1",
          email: "user@example.com",
          email_verified: true,
          nonce: HASHED_NONCE,
        },
        "different-nonce",
        [CLIENT_ID]
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 401 &&
      /nonce/.test(error.message)
  );
});

test("buildIdentity rejects an unexpected client id", () => {
  assert.throws(
    () =>
      AppleAuthService.buildIdentity(
        {
          aud: "com.attacker.app",
          sub: "apple-user-1",
          nonce: HASHED_NONCE,
        },
        RAW_NONCE,
        [CLIENT_ID]
      ),
    (error: unknown) =>
      error instanceof AppError &&
      /not issued for this application/.test(error.message)
  );
});
