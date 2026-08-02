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
  Message,
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

test("an authenticated user can idempotently register an Android FCM token", async () => {
  const findOneAndUpdate = mock.method(
    PushInstallation,
    "findOneAndUpdate",
    async (_filter: unknown, _update: unknown, _options: unknown) => ({
      installationId: "fcm-token-android-1",
      platform: "android",
    }),
  );

  try {
    const request = {
      user: { userId: "507f1f77bcf86cd799439011", email: "user@signova.app" },
      body: {
        registrationToken: " fcm-token-android-1 ",
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
        registrationToken: "fcm-token-android-1",
        platform: "android",
      },
    });
    assert.equal(findOneAndUpdate.mock.callCount(), 1);
    const call = findOneAndUpdate.mock.calls[0]!;
    const update = call.arguments[1] as { $set: { lastSeenAt: Date } };
    assert.deepEqual(call.arguments, [
      { installationId: "fcm-token-android-1" },
      {
        $set: {
          userId: "507f1f77bcf86cd799439011",
          platform: "android",
          appVersion: "1.4.0",
          registrationType: "fcm_token",
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

test("a user can only unregister an FCM token attached to their account", async () => {
  const updateOne = mock.method(
    PushInstallation,
    "updateOne",
    async (_filter: unknown, _update: unknown) => ({ modifiedCount: 1 }),
  );

  try {
    const request = {
      user: { userId: "507f1f77bcf86cd799439011", email: "user@signova.app" },
      body: { registrationToken: "fcm-token-ios-1" },
    } as unknown as Request;
    const { response, state } = makeResponse();

    await unregisterPushDevice(request, response);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.body, { message: "Push device unregistered" });
    assert.deepEqual(updateOne.mock.calls[0]!.arguments, [
      {
        installationId: "fcm-token-ios-1",
        registrationType: "fcm_token",
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
    registrationToken: "fcm-token-android-1",
    platform: "android",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    message: "Unauthorized - No token provided",
  });
});

const newSignalPayload = {
  alertType: "NEW_SIGNAL" as const,
  signalId: "signal-42",
  pair: "EURGBP",
  direction: "SELL" as const,
  entryPrice: 0.85592,
  takeProfit1: 0.85,
  takeProfit2: 0.845,
  stopLoss: 0.86,
  timeframe: "4h",
};

test("a new signal push reuses the personalized email copy", () => {
  assert.deepEqual(
    buildSignalPushMessage(newSignalPayload, "Favour"),
    {
      notification: {
        title: "We're calling a SELL on EURGBP right now.",
        body:
          "Hey Favour, we've been watching EURGBP and the setup is there. " +
          "Here's our call: Pair EURGBP. Our call SELL. Entry price 0.85592. " +
          "Timeframe 4h. View the full signal in your vault.",
      },
      data: {
        type: "signal_alert",
        alertType: "NEW_SIGNAL",
        signalId: "signal-42",
        pair: "EURGBP",
        direction: "SELL",
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

test("push delivery reports unregistered tokens so the server can disable them", async () => {
  const sendEach = mock.fn(
    async (_messages: Message[]): Promise<BatchResponse> => ({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: "message-1" },
        {
          success: false,
          error: {
            code: "messaging/registration-token-not-registered",
            message: "not registered",
            toJSON: () => ({
              code: "messaging/registration-token-not-registered",
              message: "not registered",
            }),
          } as FirebaseError,
        },
      ],
    }),
  );
  const messaging = {
    sendEach,
  } as unknown as Pick<Messaging, "sendEach">;

  const result = await deliverSignalPush(
    [
      { registrationToken: "token-good", userId: "user-1", firstName: "Ada" },
      { registrationToken: "token-dead", userId: "user-2", firstName: "Tobi" },
    ],
    newSignalPayload,
    messaging,
  );

  assert.deepEqual(result, {
    targeted: 2,
    sent: 1,
    failed: 1,
    invalidRegistrationTokens: ["token-dead"],
    errorCodes: ["messaging/registration-token-not-registered"],
  });
  assert.equal(sendEach.mock.callCount(), 1);
  assert.deepEqual(sendEach.mock.calls[0]!.arguments[0], [
    { ...buildSignalPushMessage(newSignalPayload, "Ada"), token: "token-good" },
    { ...buildSignalPushMessage(newSignalPayload, "Tobi"), token: "token-dead" },
  ]);
});

test("user push delivery disables FCM tokens that are no longer registered", async () => {
  const disabled: string[][] = [];
  const repository: PushInstallationRepository = {
    async findEnabledRegistrationTargets(recipients) {
      assert.deepEqual(recipients, [
        { userId: "user-1", firstName: "Ada" },
        { userId: "user-2", firstName: "Tobi" },
      ]);
      return [
        { registrationToken: "token-good", userId: "user-1", firstName: "Ada" },
        { registrationToken: "token-dead", userId: "user-2", firstName: "Tobi" },
      ];
    },
    async disableRegistrationTokens(registrationTokens) {
      disabled.push(registrationTokens);
    },
  };
  const messaging = {
    async sendEach(): Promise<BatchResponse> {
      return {
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true, messageId: "message-1" },
          {
            success: false,
            error: {
              code: "messaging/registration-token-not-registered",
              message: "not registered",
              toJSON: () => ({
                code: "messaging/registration-token-not-registered",
                message: "not registered",
              }),
            } as FirebaseError,
          },
        ],
      };
    },
  } as Pick<Messaging, "sendEach">;

  const result = await sendSignalPushToUsers(
    [
      { userId: "user-1", firstName: "Ada" },
      { userId: "user-2", firstName: "Tobi" },
    ],
    newSignalPayload,
    { repository, messaging },
  );

  assert.deepEqual(result, {
    targeted: 2,
    sent: 1,
    failed: 1,
    invalidRegistrationTokens: ["token-dead"],
    errorCodes: ["messaging/registration-token-not-registered"],
  });
  assert.deepEqual(disabled, [["token-dead"]]);
});

test("push delivery respects Firebase's 500-token multicast limit", async () => {
  const batches: string[][] = [];
  const messaging = {
    async sendEach(messages: Message[]): Promise<BatchResponse> {
      batches.push(
        messages.map((message) => (message as { token: string }).token),
      );
      return {
        successCount: messages.length,
        failureCount: 0,
        responses: messages.map((_, index) => ({
          success: true,
          messageId: `message-${index}`,
        })),
      };
    },
  } as Pick<Messaging, "sendEach">;
  const targets = Array.from(
    { length: 501 },
    (_, index) => ({
      registrationToken: `token-${index}`,
      userId: `user-${index}`,
      firstName: `Trader${index}`,
    }),
  );

  const result = await deliverSignalPush(
    targets,
    newSignalPayload,
    messaging,
  );

  assert.deepEqual(batches.map((batch) => batch.length), [500, 1]);
  assert.deepEqual(result, {
    targeted: 501,
    sent: 501,
    failed: 0,
    invalidRegistrationTokens: [],
    errorCodes: [],
  });
});

test("push delivery exposes batch-level Firebase errors without invalidating tokens", async () => {
  const messaging = {
    async sendEach(): Promise<BatchResponse> {
      throw Object.assign(new Error("credential rejected"), {
        code: "app/invalid-credential",
      });
    },
  } as Pick<Messaging, "sendEach">;

  const result = await deliverSignalPush(
    [
      { registrationToken: "token-one", userId: "user-1", firstName: "Ada" },
      { registrationToken: "token-two", userId: "user-2", firstName: "Tobi" },
    ],
    newSignalPayload,
    messaging,
  );

  assert.deepEqual(result, {
    targeted: 2,
    sent: 0,
    failed: 2,
    invalidRegistrationTokens: [],
    errorCodes: ["app/invalid-credential"],
  });
});
