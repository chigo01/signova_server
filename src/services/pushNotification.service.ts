import type {
  BaseMessage,
  Message,
  Messaging,
} from "firebase-admin/messaging";
import PushInstallation from "../models/pushInstallation.model";
import { getFirebaseMessaging } from "./firebaseAdmin.service";
import {
  buildSignalAlertPushBody,
  buildSignalAlertSubject,
  type SignalAlertCopyPayload,
} from "./signalAlertCopy.service";

const MOBILE_APPLICATION_ID = "com.signova.signova";
const SIGNALS_CHANNEL_ID = "signova_signals";
const FCM_MULTICAST_LIMIT = 500;
const PERMANENT_REGISTRATION_ERRORS = new Set([
  "messaging/registration-token-not-registered",
]);

export type SignalPushPayload = SignalAlertCopyPayload & {
  signalId: string;
};

export function buildSignalPushMessage(
  payload: SignalPushPayload,
  firstName = "there",
): BaseMessage {
  const notification = {
    title: buildSignalAlertSubject(payload),
    body: buildSignalAlertPushBody(payload, firstName),
  };
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

export type PushRecipient = {
  userId: string;
  firstName: string;
};

export type PushTarget = PushRecipient & {
  registrationToken: string;
};

export interface PushInstallationRepository {
  findEnabledRegistrationTargets(
    recipients: PushRecipient[],
  ): Promise<PushTarget[]>;
  disableRegistrationTokens(registrationTokens: string[]): Promise<void>;
}

const mongoosePushInstallationRepository: PushInstallationRepository = {
  async findEnabledRegistrationTargets(recipients) {
    if (recipients.length === 0) return [];
    const firstNameByUserId = new Map(
      recipients.map((recipient) => [recipient.userId, recipient.firstName]),
    );
    const installations = await PushInstallation.find({
      userId: { $in: [...firstNameByUserId.keys()] },
      registrationType: "fcm_token",
      enabled: true,
    })
      .select("installationId userId")
      .lean();
    return installations.map((installation) => ({
      registrationToken: installation.installationId,
      userId: String(installation.userId),
      firstName: firstNameByUserId.get(String(installation.userId)) ?? "there",
    }));
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
  targets: PushTarget[],
  payload: SignalPushPayload,
  messaging: Pick<Messaging, "sendEach">,
): Promise<PushDeliveryResult> {
  const uniqueTargets = [
    ...new Map(
      targets
        .filter((target) => Boolean(target.registrationToken))
        .map((target) => [target.registrationToken, target]),
    ).values(),
  ];
  const result: PushDeliveryResult = {
    targeted: uniqueTargets.length,
    sent: 0,
    failed: 0,
    invalidRegistrationTokens: [],
    errorCodes: [],
  };

  for (
    let offset = 0;
    offset < uniqueTargets.length;
    offset += FCM_MULTICAST_LIMIT
  ) {
    const batchTargets = uniqueTargets.slice(
      offset,
      offset + FCM_MULTICAST_LIMIT,
    );
    const messages: Message[] = batchTargets.map((target) => ({
      ...buildSignalPushMessage(payload, target.firstName),
      token: target.registrationToken,
    }));

    try {
      const batch = await messaging.sendEach(messages);
      result.sent += batch.successCount;
      result.failed += batch.failureCount;

      batch.responses.forEach((response, index) => {
        if (!response.success && response.error) {
          result.errorCodes.push(response.error.code);
          if (PERMANENT_REGISTRATION_ERRORS.has(response.error.code)) {
            result.invalidRegistrationTokens.push(
              batchTargets[index].registrationToken,
            );
          }
        }
      });
    } catch (error) {
      // Credential, provider, and transport failures are not evidence that the
      // installations are invalid. Preserve them for a future alert.
      result.failed += batchTargets.length;
      result.errorCodes.push(firebaseErrorCode(error));
      console.error(
        `[push] Firebase batch failed for ${batchTargets.length} registrations:`,
        error,
      );
    }
  }

  result.errorCodes = [...new Set(result.errorCodes)];
  return result;
}

export async function sendSignalPushToUsers(
  recipients: PushRecipient[],
  payload: SignalPushPayload,
  overrides: {
    repository?: PushInstallationRepository;
    messaging?: Pick<Messaging, "sendEach">;
  } = {},
): Promise<PushDeliveryResult> {
  if (recipients.length === 0) {
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
  const uniqueRecipients = [
    ...new Map(
      recipients.map((recipient) => [recipient.userId, recipient]),
    ).values(),
  ];
  const targets = await repository.findEnabledRegistrationTargets(
    uniqueRecipients,
  );

  let messaging: Pick<Messaging, "sendEach"> | null;
  try {
    messaging = overrides.messaging ?? getFirebaseMessaging();
  } catch (error) {
    console.error("[push] Firebase initialization failed:", error);
    return {
      targeted: targets.length,
      sent: 0,
      failed: targets.length,
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

  const result = await deliverSignalPush(targets, payload, messaging);

  if (result.invalidRegistrationTokens.length > 0) {
    await repository.disableRegistrationTokens(
      result.invalidRegistrationTokens,
    );
  }

  return result;
}
