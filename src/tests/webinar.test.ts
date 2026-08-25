import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import {
  constantTimeSecretMatch,
  verifyRaffleAdmin,
} from "../middleware/webinar.middleware";
import {
  createRaffleAdminSession,
  generateRaffleToken,
  isValidMeetUrl,
  normalizeWebinarRegistration,
  RAFFLE_TOKEN_ALPHABET,
  rankRaffleCandidates,
  selectRaffleWinners,
} from "../services/webinar.service";
import { webinarConfirmationEmail } from "../services/email/templates/webinar";

test("raffle tokens use the short SIG-XXXX format and unambiguous alphabet", () => {
  const indexes = [0, 1, 2, 3];
  const token = generateRaffleToken(() => indexes.shift() ?? 0);
  assert.equal(token, `SIG-${RAFFLE_TOKEN_ALPHABET.slice(0, 4)}`);
  assert.match(token, /^SIG-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  assert.equal(/[01ILO]/.test(token.slice(4)), false);
});

test("registration normalization keeps one canonical email identity", () => {
  const registration = normalizeWebinarRegistration({
    name: "  Ada   Trader ",
    email: " ADA@Example.com ",
    phone: "+234 800 000 0000",
    attribution: { utmSource: " meta ", ignored: "discarded" },
  });
  assert.equal(registration.name, "Ada Trader");
  assert.equal(registration.email, "ada@example.com");
  assert.equal(registration.attribution.utmSource, "meta");
  assert.equal("ignored" in registration.attribution, false);
});

test("registration normalization rejects invalid contact details", () => {
  assert.throws(
    () => normalizeWebinarRegistration({ name: "A", email: "bad", phone: "1" }),
    AppError
  );
});

test("only HTTPS Google Meet URLs are accepted", () => {
  assert.equal(isValidMeetUrl("https://meet.google.com/abc-defg-hij"), true);
  assert.equal(isValidMeetUrl("http://meet.google.com/abc-defg-hij"), false);
  assert.equal(isValidMeetUrl("https://example.com/abc-defg-hij"), false);
  assert.equal(isValidMeetUrl("https://meet.google.com"), false);
  assert.equal(isValidMeetUrl("https://user@meet.google.com/abc-defg-hij"), false);
});

test("service and password secrets use constant-time digest comparison", () => {
  assert.equal(constantTimeSecretMatch("correct", "correct"), true);
  assert.equal(constantTimeSecretMatch("wrong", "correct"), false);
  assert.equal(constantTimeSecretMatch(undefined, "correct"), false);
});

test("raffle admin login creates a scoped four-hour session", () => {
  const originalPassword = env.RAFFLE_ADMIN_PASSWORD;
  const originalSecret = env.RAFFLE_ADMIN_SESSION_SECRET;
  env.RAFFLE_ADMIN_PASSWORD = "correct horse battery staple";
  env.RAFFLE_ADMIN_SESSION_SECRET = "session-secret-for-tests";
  try {
    assert.throws(
      () => createRaffleAdminSession("wrong password"),
      (error: unknown) => error instanceof AppError && error.statusCode === 401
    );
    const session = createRaffleAdminSession("correct horse battery staple");
    const payload = jwt.verify(
      session.token,
      "session-secret-for-tests"
    ) as jwt.JwtPayload;
    assert.equal(payload.scope, "webinar:raffle-admin");
    assert.equal(payload.sub, "webinar-raffle-admin");
    assert.equal((payload.exp || 0) - (payload.iat || 0), 14_400);
  } finally {
    env.RAFFLE_ADMIN_PASSWORD = originalPassword;
    env.RAFFLE_ADMIN_SESSION_SECRET = originalSecret;
  }
});

test("raffle admin middleware rejects an expired session", () => {
  const originalSecret = env.RAFFLE_ADMIN_SESSION_SECRET;
  env.RAFFLE_ADMIN_SESSION_SECRET = "session-secret-for-tests";
  const expired = jwt.sign(
    { scope: "webinar:raffle-admin" },
    "session-secret-for-tests",
    { subject: "webinar-raffle-admin", expiresIn: -1 }
  );
  let statusCode = 0;
  let nextCalled = false;
  const request = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? `Bearer ${expired}` : undefined,
  };
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };

  try {
    verifyRaffleAdmin(
      request as never,
      response as never,
      (() => {
        nextCalled = true;
      }) as never
    );
    assert.equal(statusCode, 401);
    assert.equal(nextCalled, false);
  } finally {
    env.RAFFLE_ADMIN_SESSION_SECRET = originalSecret;
  }
});

const candidates = Array.from({ length: 10 }, (_, index) => ({
  token: `SIG-${String(index).padStart(4, "2")}`,
  name: `Trader ${index}`,
}));
const seed = "11".repeat(32);

test("raffle ranking is deterministic and never duplicates candidates", () => {
  const first = rankRaffleCandidates(candidates, seed);
  const second = rankRaffleCandidates([...candidates].reverse(), seed);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((entry) => entry.token)).size, candidates.length);
});

test("raffle selection rejects fewer than six eligible registrations", () => {
  assert.throws(
    () => selectRaffleWinners(candidates.slice(0, 5), seed),
    (error: unknown) => error instanceof AppError && error.statusCode === 409
  );
});

test("raffle selection returns exactly six unique winners", () => {
  const exact = selectRaffleWinners(candidates.slice(0, 6), seed);
  const larger = selectRaffleWinners(candidates, seed);
  assert.equal(exact.length, 6);
  assert.equal(larger.length, 6);
  assert.equal(new Set(larger.map((entry) => entry.token)).size, 6);
});

test("confirmation email contains the token and Meet link and escapes names", () => {
  const html = webinarConfirmationEmail({
    name: "<script>alert(1)</script>",
    token: "SIG-ABCD",
    meetUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.match(html, /SIG-ABCD/);
  assert.match(html, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.equal(html.includes("<script>alert(1)</script>"), false);
});
