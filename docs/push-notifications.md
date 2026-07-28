# Signova push notification contract

The API uses Firebase Cloud Messaging with Firebase Installation IDs (FIDs).
Registration tokens are intentionally not part of this contract because Firebase
has deprecated them in favor of FIDs.

## Server deployment

Use Node.js 22 or newer. Configure these environment variables:

```env
FIREBASE_PUSH_ENABLED=true
FIREBASE_PROJECT_ID=signova-f7c94
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/signova-firebase-admin.json
```

Mount the service-account JSON through the deployment platform's secret store.
Do not copy the JSON file or the Apple `.p8` key into the repository, container
image, or environment-variable source file.

The Firebase Cloud Messaging HTTP v1 API must be enabled for project
`signova-f7c94`.

## Apple/Firebase console configuration

In Firebase Console, open **Project settings > Cloud Messaging** and upload the
APNs authentication key for the iOS app using:

- Bundle ID: `com.signova.signova`
- APNs Key ID: `HGVQRB8ZD2`
- Apple Team ID: `TTJL7FNUXQ`

The APNs key is used by Firebase, not by this Node.js server.

## Mobile API

Both endpoints require the normal Signova bearer token.

### Register or refresh a device

`POST /push/devices`

```json
{
  "installationId": "FIREBASE_INSTALLATION_ID",
  "platform": "android",
  "appVersion": "1.4.0"
}
```

`platform` must be `android` or `ios`. Call this after login, whenever Firebase
reports a new FID, and periodically on app startup. Registration is idempotent.
Registering an existing FID moves it to the currently authenticated account,
which supports account changes on a shared device.

### Unregister a device

`DELETE /push/devices`

```json
{
  "installationId": "FIREBASE_INSTALLATION_ID"
}
```

Call this during logout or when the user disables all push delivery. The request
is idempotent and can only disable an installation owned by the authenticated
account.

## Signal notification data

Signal pushes contain a visible notification and this data payload:

```json
{
  "type": "signal_alert",
  "alertType": "NEW_SIGNAL",
  "signalId": "SIGNAL_ID",
  "pair": "EUR/USD",
  "direction": "BUY",
  "screen": "signal-details"
}
```

The mobile app should open its signal details screen using `signalId`. Android
must create a notification channel with ID `signova_signals` before the first
message arrives.

The server sends pushes from the same idempotent alert webhook used for email.
`NEW_SIGNAL` follows the user's `newSignals` preference. TP and adjustment
events follow `tradeAlerts`. SL and SL-warning delivery remains paused for both
email and push. Permanently unregistered FIDs are disabled automatically.
