const BACKOFF_MS = 5 * 60 * 1000;
const consent = {
  action: "enable-reminder-notifications",
  title: "Enable reminder notifications for this session?",
  description:
    "Reminder titles may appear on your lock screen or be seen by other people. Notifications work only while Sebby is open and only until you disable them or quit. No background service, cloud delivery, or persistent permission grant is created.",
};
/** A passive controller: host owns polling and actual native notification creation. */
export class ReminderNotificationController {
  constructor({
    reminders,
    approve = async () => false,
    deliver,
    supported = () => false,
    now = () => Date.now(),
    deliveryTimeoutMs = 10000,
  } = {}) {
    if (!reminders || typeof deliver !== "function")
      throw Error("Reminder store and delivery adapter are required.");
    this.reminders = reminders;
    this.approve = approve;
    this.deliver = deliver;
    this.supported = supported;
    this.now = now;
    this.deliveryTimeoutMs = Math.max(10, Math.min(30000, deliveryTimeoutMs));
    this.enabled = false;
    this.closed = false;
    this.enabling = false;
    this.ticking = false;
    this.generation = 0;
    this.active = new Map();
    this.failures = new Map();
    this.lastError = null;
    this.lastCheckedAt = null;
  }
  available() {
    try {
      return this.supported() === true;
    } catch {
      return false;
    }
  }
  status() {
    return {
      supported: this.available(),
      enabled: this.enabled && !this.closed,
      busy: this.enabling || this.ticking,
      lastError: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
    };
  }
  async enable() {
    if (this.closed) throw Error("Notifications are shutting down.");
    if (this.enabled) return this.status();
    if (this.enabling)
      throw Error("Finish the notification approval dialog first.");
    if (!this.available()) {
      this.lastError = "Native notifications are not supported on this system.";
      return this.status();
    }
    this.enabling = true;
    const generation = this.generation;
    try {
      const approved = await this.approve({ ...consent });
      if (approved === true && !this.closed && generation === this.generation) {
        this.enabled = true;
        this.lastError = null;
      }
    } catch {
      this.lastError = "Notification consent could not be completed.";
    } finally {
      this.enabling = false;
    }
    return this.status();
  }
  start() {
    return this.enable();
  }
  disable() {
    this.enabled = false;
    this.generation++;
    for (const controller of this.active.values()) controller.abort();
    return this.status();
  }
  shutdown() {
    this.closed = true;
    return this.disable();
  }
  async tick() {
    if (!this.enabled || this.closed || this.ticking) return this.status();
    if (!this.available()) {
      this.disable();
      this.lastError = "Native notifications are no longer supported.";
      return this.status();
    }
    this.ticking = true;
    this.lastCheckedAt = this.now();
    const generation = this.generation;
    try {
      const due = this.reminders.due();
      if (!Array.isArray(due)) throw Error("Invalid due reminders.");
      const dueIds = new Set(due.map((x) => x.id));
      for (const id of this.failures.keys())
        if (!dueIds.has(id)) this.failures.delete(id);
      const selected = due
        .filter(
          (item) =>
            !this.active.has(item.id) &&
            (this.failures.get(item.id) || 0) <= this.now(),
        )
        .slice(0, 3);
      for (const item of selected) {
        if (!this.enabled || this.closed || generation !== this.generation)
          break;
        // Recheck before each delivery in case the reminder was dismissed/snoozed while awaiting an earlier one.
        if (
          !this.reminders
            .due()
            .some(
              (candidate) =>
                candidate.id === item.id &&
                candidate.title === item.title &&
                candidate.dueAt === item.dueAt,
            )
        )
          continue;
        const controller = new AbortController();
        this.active.set(item.id, controller);
        let timer, abortListener;
        try {
          const aborted = new Promise((_, reject) => {
            abortListener = () => reject(Error("Delivery cancelled."));
            controller.signal.addEventListener("abort", abortListener, {
              once: true,
            });
          });
          timer = setTimeout(() => controller.abort(), this.deliveryTimeoutMs);
          // The adapter promise must resolve only on an actual native displayed/show event, never construction.
          await Promise.race([
            Promise.resolve().then(() => {
              if (controller.signal.aborted) throw Error("Delivery cancelled.");
              return this.deliver({
                id: item.id,
                title: item.title,
                signal: controller.signal,
              });
            }),
            aborted,
          ]);
          // A delivered notification is valid even if disable occurred after the native show event.
          await this.reminders.markDelivered(item.id);
          this.failures.delete(item.id);
        } catch {
          // Keep the record scheduled; do not immediately retry a failing OS delivery every polling tick.
          this.failures.set(item.id, this.now() + BACKOFF_MS);
          this.lastError =
            controller.signal.aborted && !this.enabled
              ? "Notification delivery stopped."
              : "A reminder could not be confirmed as displayed. It remains available in the app; retry is delayed five minutes.";
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", abortListener);
          this.active.delete(item.id);
        }
      }
    } catch {
      this.lastError =
        "Reminder notifications could not be checked. Your reminders remain available in the app.";
    } finally {
      this.ticking = false;
    }
    return this.status();
  }
}
