import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { env } from "../config/env";

let cachedMessaging: Messaging | undefined;

export function getFirebaseMessaging(): Messaging | null {
  if (!env.FIREBASE_PUSH_ENABLED) return null;
  if (cachedMessaging) return cachedMessaging;

  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          credential: applicationDefault(),
          projectId: env.FIREBASE_PROJECT_ID,
        });

  cachedMessaging = getMessaging(app);
  return cachedMessaging;
}
