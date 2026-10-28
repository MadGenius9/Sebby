import { ReminderNotificationController } from "./notifications.mjs";
/** The native class is supplied by main; this module is testable without displaying anything. */
export function makeNotificationDelivery(Notification) {
  return ({ title, signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(Error("Notification cancelled."));
        return;
      }
      const notification = new Notification({
        title: "Sebby reminder",
        body: title,
        silent: true,
      });
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        notification.removeListener("show", shown);
        notification.removeListener("failed", failed);
        notification.removeListener("close", closed);
      };
      const shown = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(Error("Native notification failed."));
      };
      const closed = () => {
        cleanup();
        reject(Error("Notification closed before display was confirmed."));
      };
      const abort = () => {
        cleanup();
        try {
          notification.close();
        } catch {}
        reject(Error("Notification cancelled."));
      };
      notification.once("show", shown);
      notification.once("failed", failed);
      notification.once("close", closed);
      signal.addEventListener("abort", abort, { once: true });
      try {
        notification.show();
      } catch {
        failed();
      }
    });
}
export function installNotifications({
  reminders,
  register,
  confirm,
  Notification,
}) {
  const controller = new ReminderNotificationController({
    reminders,
    supported: () => Notification.isSupported(),
    approve: () =>
      confirm(
        "Enable desktop reminders until Sebby quits?",
        "Reminder titles may appear on your screen or lock screen. Only reminders you saved will be shown, only while Sebby is open. Notifications are silent, opt-in for this session, and can be disabled at any time. No microphone, network, or background service is enabled.",
      ),
    deliver: makeNotificationDelivery(Notification),
  });
  register("notification-status", () => controller.status());
  register("enable-notifications", () => controller.enable());
  register("disable-notifications", () => controller.disable());
  return controller;
}
