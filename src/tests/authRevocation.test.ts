import assert from "node:assert/strict";
import test, { mock } from "node:test";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import User from "../models/user.model";
import { verifyToken } from "../middleware/auth.middleware";

function makeReq(
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {}
): Request {
  return { headers, cookies } as unknown as Request;
}

function makeRes() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

test("getTokenExpiry reads the exp claim", () => {
  // JWT_SECRET is provided by the test script env.
  const token = jwt.sign({ userId: "u1" }, "test-secret", { expiresIn: 60 });
  const expiry = AuthService.getTokenExpiry(token);
  const now = Date.now();
  // ~60s out (allow generous slack).
  assert.ok(expiry.getTime() > now + 50_000);
  assert.ok(expiry.getTime() < now + 70_000);
});

test("getTokenExpiry falls back to the standard lifetime for a tokenless input", () => {
  const expiry = AuthService.getTokenExpiry("not-a-jwt");
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(expiry.getTime() - (Date.now() + sevenDays)) < 5_000);
});

test("verifyToken rejects a request with no token", async () => {
  const { res, state } = makeRes();
  let nextCalled = false;
  await verifyToken(makeReq(), res, (() => {
    nextCalled = true;
  }) as NextFunction);
  assert.equal(state.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("verifyToken reports an invalid token as an authentication failure", async () => {
  mock.method(AuthService, "verifyToken", () => {
    throw new Error("invalid signature");
  });
  const blacklistSpy = mock.method(
    AuthService,
    "isTokenBlacklisted",
    async () => false
  );
  try {
    const { res, state } = makeRes();
    let nextCalled = false;
    await verifyToken(
      makeReq({ authorization: "Bearer invalid.token" }),
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction
    );
    assert.equal(state.statusCode, 401);
    assert.match((state.body as { message: string }).message, /expired token/);
    assert.equal(blacklistSpy.mock.callCount(), 0);
    assert.equal(nextCalled, false);
  } finally {
    mock.restoreAll();
  }
});

test("verifyToken passes blacklist database failures to the error handler", async () => {
  const databaseError = new Error("database unavailable");
  mock.method(AuthService, "verifyToken", () => ({
    userId: "u1",
    email: "u1@x.com",
  }));
  mock.method(AuthService, "isTokenBlacklisted", async () => {
    throw databaseError;
  });
  try {
    const { res, state } = makeRes();
    let nextError: unknown;
    await verifyToken(
      makeReq({ authorization: "Bearer valid.token" }),
      res,
      ((error: unknown) => {
        nextError = error;
      }) as NextFunction
    );
    assert.equal(state.statusCode, 200);
    assert.equal(state.body, undefined);
    assert.equal(nextError, databaseError);
  } finally {
    mock.restoreAll();
  }
});

test("verifyToken passes user database failures to the error handler", async () => {
  const databaseError = new Error("database unavailable");
  mock.method(AuthService, "verifyToken", () => ({
    userId: "u1",
    email: "u1@x.com",
  }));
  mock.method(AuthService, "isTokenBlacklisted", async () => false);
  mock.method(User, "exists", async () => {
    throw databaseError;
  });
  try {
    const { res, state } = makeRes();
    let nextError: unknown;
    await verifyToken(
      makeReq({ authorization: "Bearer valid.token" }),
      res,
      ((error: unknown) => {
        nextError = error;
      }) as NextFunction
    );
    assert.equal(state.statusCode, 200);
    assert.equal(state.body, undefined);
    assert.equal(nextError, databaseError);
  } finally {
    mock.restoreAll();
  }
});

test("verifyToken rejects a revoked (blacklisted) token", async () => {
  mock.method(AuthService, "verifyToken", () => ({
    userId: "u1",
    email: "u1@x.com",
  }));
  mock.method(AuthService, "isTokenBlacklisted", async () => true);
  try {
    const { res, state } = makeRes();
    let nextCalled = false;
    await verifyToken(
      makeReq({ authorization: "Bearer revoked.token.here" }),
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction
    );
    assert.equal(state.statusCode, 401);
    assert.match((state.body as { message: string }).message, /revoked/);
    assert.equal(nextCalled, false);
  } finally {
    mock.restoreAll();
  }
});

test("verifyToken rejects a valid token whose user no longer exists", async () => {
  mock.method(AuthService, "isTokenBlacklisted", async () => false);
  mock.method(AuthService, "verifyToken", () => ({
    userId: "gone",
    email: "gone@x.com",
  }));
  mock.method(User, "exists", async () => null);
  try {
    const { res, state } = makeRes();
    let nextCalled = false;
    await verifyToken(
      makeReq({ authorization: "Bearer good.token" }),
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction
    );
    assert.equal(state.statusCode, 401);
    assert.match((state.body as { message: string }).message, /User not found/);
    assert.equal(nextCalled, false);
  } finally {
    mock.restoreAll();
  }
});

test("verifyToken passes a valid token for an existing, non-revoked user", async () => {
  mock.method(AuthService, "isTokenBlacklisted", async () => false);
  mock.method(AuthService, "verifyToken", () => ({
    userId: "u1",
    email: "u1@x.com",
  }));
  mock.method(User, "exists", async () => ({ _id: "u1" }));
  try {
    const req = makeReq({ authorization: "Bearer good.token" });
    const { res, state } = makeRes();
    let nextCalled = false;
    await verifyToken(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(state.statusCode, 200);
    assert.deepEqual(req.user, { userId: "u1", email: "u1@x.com" });
  } finally {
    mock.restoreAll();
  }
});
