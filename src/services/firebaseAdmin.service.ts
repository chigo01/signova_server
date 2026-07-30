import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { env } from "../config/env";

let cachedMessaging: Messaging | undefined;

function credentialError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "app/invalid-credential",
  });
}

function parseServiceAccount(
  raw: string,
  source: string,
): ServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw credentialError(
      `${source} must contain valid service-account JSON`,
    );
  }

  if (!value || typeof value !== "object") {
    throw credentialError(
      `${source} must contain a service-account JSON object`,
    );
  }

  const record = value as Record<string, unknown>;
  const projectId = record.project_id ?? record.projectId;
  const clientEmail = record.client_email ?? record.clientEmail;
  const privateKey = record.private_key ?? record.privateKey;
  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string"
  ) {
    throw credentialError(
      `${source} is missing project_id, client_email, or private_key`,
    );
  }

  if (projectId !== env.FIREBASE_PROJECT_ID) {
    throw credentialError(
      `${source} belongs to Firebase project ${projectId}, but FIREBASE_PROJECT_ID is ${env.FIREBASE_PROJECT_ID}`,
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function firebaseCredential() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    return cert(
      parseServiceAccount(inlineJson, "FIREBASE_SERVICE_ACCOUNT_JSON"),
    );
  }

  const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (base64Json) {
    const decoded = Buffer.from(base64Json, "base64").toString("utf8");
    return cert(
      parseServiceAccount(decoded, "FIREBASE_SERVICE_ACCOUNT_BASE64"),
    );
  }

  const googleCredentials =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (googleCredentials?.startsWith("{")) {
    console.warn(
      "[push] GOOGLE_APPLICATION_CREDENTIALS contains JSON; prefer FIREBASE_SERVICE_ACCOUNT_JSON. Supporting it for deployment compatibility.",
    );
    return cert(
      parseServiceAccount(
        googleCredentials,
        "GOOGLE_APPLICATION_CREDENTIALS",
      ),
    );
  }

  // Standard Google Application Default Credentials. On Render,
  // GOOGLE_APPLICATION_CREDENTIALS must be an absolute secret-file path such
  // as /etc/secrets/firebase-service-account.json, not the JSON itself.
  return applicationDefault();
}

export function getFirebaseMessaging(): Messaging | null {
  if (!env.FIREBASE_PUSH_ENABLED) return null;
  if (cachedMessaging) return cachedMessaging;

  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          credential: firebaseCredential(),
          projectId: env.FIREBASE_PROJECT_ID,
        });

  cachedMessaging = getMessaging(app);
  return cachedMessaging;
}
