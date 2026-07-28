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

test("buildGoogleIdentity requires the verified-email claim", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdentity(
        { aud: EXPECTED_AUD },
        { email: "user@gmail.com", sub: "7" },
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

test("buildGoogleIdentity accepts any configured Signova audience", () => {
  const identity = AuthService.buildGoogleIdentity(
    { aud: "signova-ios.apps.googleusercontent.com" },
    { email: "ios@gmail.com", email_verified: true, sub: "ios-1" },
    [EXPECTED_AUD, "signova-ios.apps.googleusercontent.com"]
  );
  assert.equal(identity.googleId, "ios-1");
});

test("buildGoogleIdTokenIdentity accepts a verified native ID token", () => {
  const identity = AuthService.buildGoogleIdTokenIdentity(
    {
      aud: EXPECTED_AUD,
      sub: "native-1",
      email: "Native.User@gmail.com",
      email_verified: true,
      name: "Native User",
      iss: "accounts.google.com",
      iat: 1,
      exp: 2,
    },
    [EXPECTED_AUD]
  );
  assert.deepEqual(identity, {
    email: "native.user@gmail.com",
    name: "Native User",
    googleId: "native-1",
  });
});

test("buildGoogleIdTokenIdentity rejects an unexpected audience", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdTokenIdentity(
        {
          aud: "another-app.apps.googleusercontent.com",
          sub: "native-2",
          email: "user@gmail.com",
          email_verified: true,
          iss: "accounts.google.com",
          iat: 1,
          exp: 2,
        },
        [EXPECTED_AUD]
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.statusCode === 401 &&
      /not issued for this application/.test(err.message)
  );
});

test("buildGoogleIdTokenIdentity requires an explicitly verified email", () => {
  assert.throws(
    () =>
      AuthService.buildGoogleIdTokenIdentity(
        {
          aud: EXPECTED_AUD,
          sub: "native-3",
          email: "user@gmail.com",
          email_verified: false,
          iss: "accounts.google.com",
          iat: 1,
          exp: 2,
        },
        [EXPECTED_AUD]
      ),
    (err: unknown) =>
      err instanceof AppError && /not verified/.test(err.message)
  );
});
