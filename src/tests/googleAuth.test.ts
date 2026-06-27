import assert from "node:assert/strict";
import test from "node:test";
import { AuthService } from "../services/auth.service";
import { AppError } from "../middleware/errorHandler";

const EXPECTED_AUD = "signova-client-id.apps.googleusercontent.com";

test("buildGoogleIdentity returns identity when audience matches", () => {
  const identity = AuthService.buildGoogleIdentity(
    { aud: EXPECTED_AUD },
    { email: "user@gmail.com", email_verified: true, name: "User", sub: "123" },
    EXPECTED_AUD
  );
  assert.deepEqual(identity, {
    email: "user@gmail.com",
    name: "User",
    googleId: "123",
  });
});

test("buildGoogleIdentity rejects a token minted for a different OAuth app", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdentity(
        { aud: "attacker-app.apps.googleusercontent.com" },
        { email: "victim@gmail.com", email_verified: true, sub: "999" },
        EXPECTED_AUD
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.statusCode === 401 &&
      /not issued for this application/.test(err.message)
  );
});

test("buildGoogleIdentity rejects a token with no audience claim", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdentity(
        {},
        { email: "user@gmail.com", email_verified: true, sub: "1" },
        EXPECTED_AUD
      ),
    (err: unknown) => err instanceof AppError && err.statusCode === 401
  );
});

test("buildGoogleIdentity accepts azp when aud is absent and matches", () => {
  const identity = AuthService.buildGoogleIdentity(
    { azp: EXPECTED_AUD },
    { email: "user@gmail.com", email_verified: true, sub: "42" },
    EXPECTED_AUD
  );
  assert.equal(identity.googleId, "42");
});

test("buildGoogleIdentity rejects an unverified email", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdentity(
        { aud: EXPECTED_AUD },
        { email: "user@gmail.com", email_verified: false, sub: "7" },
        EXPECTED_AUD
      ),
    (err: unknown) =>
      err instanceof AppError && /not verified/.test(err.message)
  );
});

test("buildGoogleIdentity rejects a profile missing identity claims", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdentity(
        { aud: EXPECTED_AUD },
        { email: undefined, sub: undefined },
        EXPECTED_AUD
      ),
    (err: unknown) =>
      err instanceof AppError && /missing identity claims/.test(err.message)
  );
});

test("buildGoogleIdentity falls back to email local-part when name is absent", () => {
  const identity = AuthService.buildGoogleIdentity(
    { aud: EXPECTED_AUD },
    { email: "jane.doe@gmail.com", email_verified: true, sub: "8" },
    EXPECTED_AUD
  );
  assert.equal(identity.name, "jane.doe");
});
