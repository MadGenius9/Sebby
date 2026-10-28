import { useEffect, useState } from "react";
import { utilities, team, type TeamMember } from "./bridge";
export function UtilityLauncher({
  report,
  refresh,
}: {
  report: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]),
    [kind, setKind] = useState<"workspace-inventory" | "project-brief">(
      "workspace-inventory",
    ),
    [memberId, setMemberId] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (team)
      team
        .listTeam()
        .then(setMembers)
        .catch((e) => report(e.message));
  }, []);
  if (!utilities) return null;
  const role = kind === "workspace-inventory" ? "researcher" : "planner";
  return (
    <div className="callout">
      <h3>Run a real local utility</h3>
      <p>
        Deterministic, read-only work—not AI. A workspace inventory lists
        bounded file names and sizes. A project brief adds an unfilled template.
        No file contents, commands, network or project writes.
      </p>
      <div className="form-grid">
        <label>
          Utility
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setMemberId("");
            }}
          >
            <option value="workspace-inventory">Workspace inventory</option>
            <option value="project-brief">Project brief template</option>
          </select>
        </label>
        <label>
          Specialist label (optional)
          <select
            value={memberId}
            disabled={busy}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members
              .filter(
                (m) =>
                  m.role === role &&
                  m.status !== "retired" &&
                  !m.assignedTaskId,
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.specialty}
                </option>
              ))}
          </select>
        </label>
      </div>
      <button
        className="primary spaced"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await utilities!.startLocalUtility({
              kind,
              ...(memberId ? { memberId } : {}),
            });
            setNotice(
              result.started
                ? "Local utility started. Its report will appear below for separate review."
                : "Cancelled. No utility started.",
            );
            if (team) setMembers(await team.listTeam());
            await refresh();
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Review and start utility…
      </button>
      <p role="status">{notice}</p>
    </div>
  );
}
