import type {
  BaseMessage,
  Messaging,
  MulticastMessage,
} from "firebase-admin/messaging";
import type { SignalAlertType } from "../models/signalAlertNotification.model";
import PushInstallation from "../models/pushInstallation.model";
import { getFirebaseMessaging } from "./firebaseAdmin.service";

const MOBILE_APPLICATION_ID = "com.signova.signova";
const SIGNALS_CHANNEL_ID = "signova_signals";
const FCM_MULTICAST_LIMIT = 500;
const PERMANENT_REGISTRATION_ERRORS = new Set([
  "messaging/registration-token-not-registered",
]);

export type SignalPushPayload = {
  alertType: SignalAlertType;
  signalId: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
};

function signalPushCopy(payload: SignalPushPayload): {
  title: string;
  body: string;
} {
  switch (payload.alertType) {
    case "NEW_SIGNAL":
      return {
        title: `New ${payload.pair} ${payload.direction} signal`,
        body: `A new ${payload.direction} setup is available.`,
      };
    case "TP1":
      return {
        title: `${payload.pair} reached TP1`,
        body: "The first profit target has been reached.",
      };
    case "TP2":
      return {
        title: `${payload.pair} reached TP2`,
        body: "The final profit target has been reached.",
      };
    case "SL_WARNING":
      return {
        title: `${payload.pair} is approaching stop loss`,
        body: "Review the latest signal status in Signova.",
      };
    case "SL":
      return {
        title: `${payload.pair} stop loss reached`,
        body: "The signal has been closed.",
      };
    case "SIGNAL_ADJUSTED":
      return {
        title: `${payload.pair} signal updated`,
        body: "Entry and risk levels have been updated.",
      };
  }
}

export function buildSignalPushMessage(payload: SignalPushPayload): BaseMessage {
  const notification = signalPushCopy(payload);
  return {
    notification,
    data: {
      type: "signal_alert",
      alertType: payload.alertType,
      signalId: payload.signalId,
      pair: payload.pair,
      direction: payload.direction,
      screen: "signal-details",
    },
    android: {
      priority: "high",
      restrictedPackageName: MOBILE_APPLICATION_ID,
      notification: {
        channelId: SIGNALS_CHANNEL_ID,
        sound: "default",
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-topic": MOBILE_APPLICATION_ID,
      },
      payload: {
        aps: {
          sound: "default",
          threadId: payload.signalId,
        },
      },
    },
  };
}

export type PushDeliveryResult = {
  targeted: number;
  sent: number;
  failed: number;
  invalidRegistrationTokens: string[];
  errorCodes: string[];
};

export interface PushInstallationRepository {
  findEnabledRegistrationTokens(userIds: string[]): Promise<string[]>;
  disableRegistrationTokens(registrationTokens: string[]): Promise<void>;
}

const mongoosePushInstallationRepository: PushInstallationRepository = {
  async findEnabledRegistrationTokens(userIds) {
    if (userIds.length === 0) return [];
    const installations = await PushInstallation.find({
      userId: { $in: userIds },
      registrationType: "fcm_token",
      enabled: true,
    })
      .select("installationId")
      .lean();
    return installations.map((installation) => installation.installationId);
  },

  async disableRegistrationTokens(registrationTokens) {
    if (registrationTokens.length === 0) return;
    await PushInstallation.updateMany(
      {
        installationId: { $in: registrationTokens },
        registrationType: "fcm_token",
      },
      { $set: { enabled: false } },
    );
  },
};

function firebaseErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "messaging/unknown-error";
}

export async function deliverSignalPush(
  registrationTokens: string[],
  payload: SignalPushPayload,
  messaging: Pick<Messaging, "sendEachForMulticast">,
): Promise<PushDeliveryResult> {
  const uniqueRegistrationTokens = [
    ...new Set(registrationTokens.filter(Boolean)),
  ];
  const result: PushDeliveryResult = {
    targeted: uniqueRegistrationTokens.length,
    sent: 0,
    failed: 0,
    invalidRegistrationTokens: [],
    errorCodes: [],
  };

  const baseMessage = buildSignalPushMessage(payload);
  for (
    let offset = 0;
    offset < uniqueRegistrationTokens.length;
    offset += FCM_MULTICAST_LIMIT
  ) {
    const tokens = uniqueRegistrationTokens.slice(
      offset,
      offset + FCM_MULTICAST_LIMIT,
    );
    const message: MulticastMessage = { ...baseMessage, tokens };

    try {
      const batch = await messaging.sendEachForMulticast(message);
      result.sent += batch.successCount;
      result.failed += batch.failureCount;

      batch.responses.forEach((response, index) => {
        if (!response.success && response.error) {
          result.errorCodes.push(response.error.code);
          if (PERMANENT_REGISTRATION_ERRORS.has(response.error.code)) {
            result.invalidRegistrationTokens.push(tokens[index]);
          }
        }
      });
    } catch (error) {
      // Credential, provider, and transport failures are not evidence that the
      // installations are invalid. Preserve them for a future alert.
      result.failed += tokens.length;
      result.errorCodes.push(firebaseErrorCode(error));
      console.error(
        `[push] Firebase batch failed for ${tokens.length} registrations:`,
        error,
      );
    }
  }

  result.errorCodes = [...new Set(result.errorCodes)];
  return result;
}

export async function sendSignalPushToUsers(
  userIds: string[],
  payload: SignalPushPayload,
  overrides: {
    repository?: PushInstallationRepository;
    messaging?: Pick<Messaging, "sendEachForMulticast">;
  } = {},
): Promise<PushDeliveryResult> {
  if (userIds.length === 0) {
    return {
      targeted: 0,
      sent: 0,
      failed: 0,
      invalidRegistrationTokens: [],
      errorCodes: [],
    };
  }

  const repository =
    overrides.repository ?? mongoosePushInstallationRepository;
  const registrationTokens = await repository.findEnabledRegistrationTokens([
    ...new Set(userIds),
  ]);

  let messaging: Pick<Messaging, "sendEachForMulticast"> | null;
  try {
    messaging = overrides.messaging ?? getFirebaseMessaging();
  } catch (error) {
    console.error("[push] Firebase initialization failed:", error);
    return {
      targeted: registrationTokens.length,
      sent: 0,
      failed: registrationTokens.length,
      invalidRegistrationTokens: [],
      errorCodes: [firebaseErrorCode(error)],
    };
  }

  if (!messaging) {
    return {
      targeted: 0,
      sent: 0,
      failed: 0,
      invalidRegistrationTokens: [],
      errorCodes: [],
    };
  }

  const result = await deliverSignalPush(
    registrationTokens,
    payload,
    messaging,
  );

  if (result.invalidRegistrationTokens.length > 0) {
    await repository.disableRegistrationTokens(
      result.invalidRegistrationTokens,
    );
  }

  return result;
}
