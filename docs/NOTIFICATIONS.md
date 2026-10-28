# Session-only reminder notifications

`ReminderNotificationController` is a provider-independent passive controller. It does not import Electron, schedule its own interval, create an OS notification, request microphone access, or start a background service. The main process owns native approval, actual notification delivery, and polling.

## API

```js
const controller = new ReminderNotificationController({
  reminders, // ReminderStore
  approve: async disclosure => nativeConfirmation(disclosure),
  supported: () => nativeNotificationSupport(),
  deliver: ({id, title, signal}) => nativeShowEventPromise({id, title, signal})
});
await controller.enable(); // start() is an alias
await controller.tick();   // main process may poll while the app is open
controller.status();
controller.disable();
controller.shutdown();
```

`approve` defaults to deny. Enabling requires explicit native consent and discloses that titles may appear on lock screens or be visible to others. Approval applies only while this controller instance remains enabled, until disable or app quit. It is not stored. An OS-level permission may exist independently; Sebby must still ask its own session-level approval. No delivery starts when support is unavailable.

`deliver` is a **trusted main-process adapter**, never a renderer callback. It receives only reminder ID/title and an AbortSignal. Resolve only on the native **show/displayed event**, not after constructing a notification or calling show(). Reject on native error or abort. Listen for abort before starting, suppress creation if already aborted, and close/cleanup any pending native object when disabled or shutting down. Remove event listeners after settlement. Do not add links, buttons, remote imagery, audio files, or arbitrary actions. No remote server or AI is involved.

`status()` returns `{supported, enabled, busy, lastError, lastCheckedAt}`. Error text is fixed and never includes raw OS/adapter details. `shutdown()` aborts pending work and permanently refuses enabling. Main should call it during quit and stop its polling interval. `disable()` aborts in-flight deliveries and blocks new ones; existing notifications already shown by the OS might remain until closed by the host or user.

## Delivery behavior

Each tick considers at most three due reminders. Overlapping ticks do not deliver duplicates; each reminder has at most one active adapter call. Reminders are rechecked before delivery in case they were snoozed/dismissed while earlier delivery was pending. Delivery is confirmed only after the native show event, then `markDelivered` is awaited. If a notification was already displayed, recording that result remains valid even when disabling immediately afterward.

A timeout or error leaves the reminder in the in-app scheduled list and establishes a five-minute in-memory backoff for that reminder. Backoff is session-local, not a durable retry schedule. The default confirmation timeout is 10 seconds (configurable test seam, capped at 30 seconds). No retry starts while disabled or closed. A misbehaving adapter that ignores cancellation cannot be controlled by this pure module; the native adapter must enforce AbortSignal before showing anything.

This is **not exactly-once delivery**: a process crash after native display but before durable marking can cause redisplay next session after fresh consent. OS focus/do-not-disturb settings can suppress visual presentation despite native event behavior; do not promise the user saw the notification. Persistent reminders remain available in-app. No notification is promised while Sebby is closed, asleep, or offline in another session.

## Evidence

`node --test tests/notifications.test.mjs`: 7/7 pass with fake clock/delivery adapters. Covers default-off behavior, consent/support gating, three-per-tick bound, serialized delivery, failure/backoff, timeout, abort/disable, pending-consent shutdown and successful durable delivery marking. **No real OS notifications were produced or observed.** Native adapter behavior and Windows lock-screen/permission/display behavior require manual verification.

## Native adapter wiring

`electron/notification-ipc.mjs` uses Electron's [Notification show/failed/close events](https://github.com/electron/electron/blob/main/docs/api/notification.md) with `silent: true`; a call to `show()` alone never counts as displayed. Abort closes the pending native object and removes listeners. Main polls every 30 seconds only while active and not restoring data. It aborts on shutdown. Windows uses the app's configured AppUserModelID. Real Windows display/OS permission behavior remains untested.
