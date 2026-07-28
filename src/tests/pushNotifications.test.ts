import assert from "node:assert/strict";
import test, { mock } from "node:test";
import express from "express";
import supertest from "supertest";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import PushInstallation from "../models/pushInstallation.model";
import {
  registerPushDevice,
  unregisterPushDevice,
} from "../controllers/push.controller";
import pushRoutes from "../routes/push.routes";
import type {
  BatchResponse,
  FidMulticastMessage,
  Messaging,
} from "firebase-admin/messaging";
import type { FirebaseError } from "firebase-admin/app";
import {
  buildSignalPushMessage,
  deliverSignalPush,
  sendSignalPushToUsers,
  type PushInstallationRepository,
} from "../services/pushNotification.service";

function makeResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

test("an authenticated user can idempotently register an Android Firebase installation", async () => {
  const findOneAndUpdate = mock.method(
    PushInstallation,
    "findOneAndUpdate",
    async (_filter: unknown, _update: unknown, _options: unknown) => ({
      installationId: "fid-android-1",
      platform: "android",
    }),
  );

  try {
    const request = {
      user: { userId: "507f1f77bcf86cd799439011", email: "user@signova.app" },
      body: {
        installationId: " fid-android-1 ",
        platform: "android",
        appVersion: "1.4.0",
      },
    } as unknown as Request;
    const { response, state } = makeResponse();

    await registerPushDevice(request, response);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.body, {
      message: "Push device registered",
      installation: {
        installationId: "fid-android-1",
        platform: "android",
      },
    });
    assert.equal(findOneAndUpdate.mock.callCount(), 1);
    const call = findOneAndUpdate.mock.calls[0]!;
    const update = call.arguments[1] as { $set: { lastSeenAt: Date } };
    assert.deepEqual(call.arguments, [
      { installationId: "fid-android-1" },
      {
        $set: {
          userId: "507f1f77bcf86cd799439011",
          platform: "android",
          appVersion: "1.4.0",
          enabled: true,
          lastSeenAt: update.$set.lastSeenAt,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ]);
    assert.ok(update.$set.lastSeenAt instanceof Date);
  } finally {
    mock.restoreAll();
  }
});

test("a user can only unregister a Firebase installation attached to their account", async () => {
  const updateOne = mock.method(
    PushInstallation,
    "updateOne",
    async (_filter: unknown, _update: unknown) => ({ modifiedCount: 1 }),
  );

  try {
    const request = {
      user: { userId: "507f1f77bcf86cd799439011", email: "user@signova.app" },
      body: { installationId: "fid-ios-1" },
    } as unknown as Request;
    const { response, state } = makeResponse();

    await unregisterPushDevice(request, response);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.body, { message: "Push device unregistered" });
    assert.deepEqual(updateOne.mock.calls[0]!.arguments, [
      {
        installationId: "fid-ios-1",
        userId: "507f1f77bcf86cd799439011",
      },
      { $set: { enabled: false } },
    ]);
  } finally {
    mock.restoreAll();
  }
});

test("push device routes reject unauthenticated callers", async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/push", pushRoutes);

  const response = await supertest(app).post("/push/devices").send({
    installationId: "fid-android-1",
    platform: "android",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    message: "Unauthorized - No token provided",
  });
});

test("a new signal push uses the FID-ready Android and iOS payload contract", () => {
  assert.deepEqual(
    buildSignalPushMessage({
      alertType: "NEW_SIGNAL",
      signalId: "signal-42",
      pair: "EUR/USD",
      direction: "BUY",
    }),
    {
      notification: {
        title: "New EUR/USD BUY signal",
        body: "A new BUY setup is available.",
      },
      data: {
        type: "signal_alert",
        alertType: "NEW_SIGNAL",
        signalId: "signal-42",
        pair: "EUR/USD",
        direction: "BUY",
        screen: "signal-details",
      },
      android: {
        priority: "high",
        restrictedPackageName: "com.signova.signova",
        notification: {
          channelId: "signova_signals",
          sound: "default",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-topic": "com.signova.signova",
        },
        payload: {
          aps: {
            sound: "default",
            threadId: "signal-42",
          },
        },
      },
    },
  );
});

test("push delivery reports unregistered FIDs so the server can disable them", async () => {
  const sendEachForMulticast = mock.fn(
    async (_message: unknown): Promise<BatchResponse> => ({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: "message-1" },
        {
          success: false,
          error: {
            code: "messaging/installation-id-not-registered",
            message: "not registered",
            toJSON: () => ({
              code: "messaging/installation-id-not-registered",
              message: "not registered",
            }),
          } as FirebaseError,
        },
      ],
    }),
  );
  const messaging = {
    sendEachForMulticast,
  } as unknown as Pick<Messaging, "sendEachForMulticast">;

  const result = await deliverSignalPush(
    ["fid-good", "fid-dead"],
    {
      alertType: "TP1",
      signalId: "signal-42",
      pair: "EUR/USD",
      direction: "BUY",
    },
    messaging,
  );

  assert.deepEqual(result, {
    targeted: 2,
    sent: 1,
    failed: 1,
    invalidInstallationIds: ["fid-dead"],
  });
  assert.equal(sendEachForMulticast.mock.callCount(), 1);
  assert.deepEqual(sendEachForMulticast.mock.calls[0]!.arguments[0], {
    ...buildSignalPushMessage({
      alertType: "TP1",
      signalId: "signal-42",
      pair: "EUR/USD",
      direction: "BUY",
    }),
    fids: ["fid-good", "fid-dead"],
  });
});

test("user push delivery disables Firebase installations that are no longer registered", async () => {
  const disabled: string[][] = [];
  const repository: PushInstallationRepository = {
    async findEnabledInstallationIds(userIds) {
      assert.deepEqual(userIds, ["user-1", "user-2"]);
      return ["fid-good", "fid-dead"];
    },
    async disableInstallationIds(installationIds) {
      disabled.push(installationIds);
    },
  };
  const messaging = {
    async sendEachForMulticast(): Promise<BatchResponse> {
      return {
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true, messageId: "message-1" },
          {
            success: false,
            error: {
              code: "messaging/installation-id-not-registered",
              message: "not registered",
              toJSON: () => ({
                code: "messaging/installation-id-not-registered",
                message: "not registered",
              }),
            } as FirebaseError,
          },
        ],
      };
    },
  } as Pick<Messaging, "sendEachForMulticast">;

  const result = await sendSignalPushToUsers(
    ["user-1", "user-2"],
    {
      alertType: "SIGNAL_ADJUSTED",
      signalId: "signal-42",
      pair: "EUR/USD",
      direction: "BUY",
    },
    { repository, messaging },
  );

  assert.deepEqual(result, {
    targeted: 2,
    sent: 1,
    failed: 1,
    invalidInstallationIds: ["fid-dead"],
  });
  assert.deepEqual(disabled, [["fid-dead"]]);
});

test("push delivery respects Firebase's 500-FID multicast limit", async () => {
  const batches: string[][] = [];
  const messaging = {
    async sendEachForMulticast(
      message: FidMulticastMessage,
    ): Promise<BatchResponse> {
      batches.push(message.fids);
      return {
        successCount: message.fids.length,
        failureCount: 0,
        responses: message.fids.map((_, index) => ({
          success: true,
          messageId: `message-${index}`,
        })),
      };
    },
  } as Pick<Messaging, "sendEachForMulticast">;
  const installationIds = Array.from(
    { length: 501 },
    (_, index) => `fid-${index}`,
  );

  const result = await deliverSignalPush(
    installationIds,
    {
      alertType: "TP2",
      signalId: "signal-42",
      pair: "EUR/USD",
      direction: "BUY",
    },
    messaging,
  );

  assert.deepEqual(batches.map((batch) => batch.length), [500, 1]);
  assert.deepEqual(result, {
    targeted: 501,
    sent: 501,
    failed: 0,
    invalidInstallationIds: [],
  });
});
