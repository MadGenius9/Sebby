import { useEffect, useState } from "react";
import { notifications, type NotificationStatus } from "./bridge";
export function NotificationControls({
  report,
}: {
  report: (s: string) => void;
}) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  useEffect(() => {
    if (!notifications?.notificationStatus) return;
    let live = true;
    const refresh = () =>
      notifications!
        .notificationStatus()
        .then((s) => {
          if (live) setStatus(s);
        })
        .catch((e) => {
          if (live) report(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  if (!notifications?.notificationStatus) return null;
  return (
    <div className="callout">
      <h3>Desktop reminders · off by default</h3>
      <p>
        Optional silent notifications, only while Sebby is open and only until
        it quits. Reminder titles may be visible on your lock screen. OS support
        and permission are required.
      </p>
      <p role="status">
        {!status
          ? "Checking local notification support…"
          : !status.supported
            ? "Native notifications unavailable on this system."
            : status.enabled
              ? "Enabled for this session."
              : "Disabled. Nothing will be shown outside this page."}
      </p>
      {status?.lastError && <p>{status.lastError}</p>}
      <div className="button-row">
        <button
          className="secondary"
          disabled={!status?.supported || status.enabled}
          onClick={async () => {
            try {
              setStatus(await notifications!.enableNotifications());
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          Enable until quit…
        </button>
        <button
          className="text-button"
          disabled={!status?.enabled}
          onClick={async () => {
            try {
              setStatus(await notifications!.disableNotifications());
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          Disable desktop reminders
        </button>
      </div>
    </div>
  );
}
