import type {
  BaseMessage,
  FidMulticastMessage,
  Messaging,
} from "firebase-admin/messaging";
import type { SignalAlertType } from "../models/signalAlertNotification.model";
import PushInstallation from "../models/pushInstallation.model";
import { getFirebaseMessaging } from "./firebaseAdmin.service";

const MOBILE_APPLICATION_ID = "com.signova.signova";
const SIGNALS_CHANNEL_ID = "signova_signals";
const FCM_MULTICAST_LIMIT = 500;
const PERMANENT_INSTALLATION_ERRORS = new Set([
  "messaging/installation-id-not-registered",
  // Keep cleanup compatible during Firebase's FID migration window.
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
  invalidInstallationIds: string[];
};

export interface PushInstallationRepository {
  findEnabledInstallationIds(userIds: string[]): Promise<string[]>;
  disableInstallationIds(installationIds: string[]): Promise<void>;
}

const mongoosePushInstallationRepository: PushInstallationRepository = {
  async findEnabledInstallationIds(userIds) {
    if (userIds.length === 0) return [];
    const installations = await PushInstallation.find({
      userId: { $in: userIds },
      enabled: true,
    })
      .select("installationId")
      .lean();
    return installations.map((installation) => installation.installationId);
  },

  async disableInstallationIds(installationIds) {
    if (installationIds.length === 0) return;
    await PushInstallation.updateMany(
      { installationId: { $in: installationIds } },
      { $set: { enabled: false } },
    );
  },
};

export async function deliverSignalPush(
  installationIds: string[],
  payload: SignalPushPayload,
  messaging: Pick<Messaging, "sendEachForMulticast">,
): Promise<PushDeliveryResult> {
  const uniqueInstallationIds = [...new Set(installationIds.filter(Boolean))];
  const result: PushDeliveryResult = {
    targeted: uniqueInstallationIds.length,
    sent: 0,
    failed: 0,
    invalidInstallationIds: [],
  };

  const baseMessage = buildSignalPushMessage(payload);
  for (
    let offset = 0;
    offset < uniqueInstallationIds.length;
    offset += FCM_MULTICAST_LIMIT
  ) {
    const fids = uniqueInstallationIds.slice(
      offset,
      offset + FCM_MULTICAST_LIMIT,
    );
    const message: FidMulticastMessage = { ...baseMessage, fids };

    try {
      const batch = await messaging.sendEachForMulticast(message);
      result.sent += batch.successCount;
      result.failed += batch.failureCount;

      batch.responses.forEach((response, index) => {
        if (
          !response.success &&
          response.error &&
          PERMANENT_INSTALLATION_ERRORS.has(response.error.code)
        ) {
          result.invalidInstallationIds.push(fids[index]);
        }
      });
    } catch (error) {
      // Credential, provider, and transport failures are not evidence that the
      // installations are invalid. Preserve them for a future alert.
      result.failed += fids.length;
      console.error(
        `[push] Firebase batch failed for ${fids.length} installations:`,
        error,
      );
    }
  }

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
  const messaging = overrides.messaging ?? getFirebaseMessaging();
  if (!messaging || userIds.length === 0) {
    return {
      targeted: 0,
      sent: 0,
      failed: 0,
      invalidInstallationIds: [],
    };
  }

  const repository =
    overrides.repository ?? mongoosePushInstallationRepository;
  const installationIds = await repository.findEnabledInstallationIds([
    ...new Set(userIds),
  ]);
  const result = await deliverSignalPush(installationIds, payload, messaging);

  if (result.invalidInstallationIds.length > 0) {
    await repository.disableInstallationIds(result.invalidInstallationIds);
  }

  return result;
}
