import { useEffect, useState } from "react";
import { Users, Plus } from "lucide-react";
import { team, local, type TeamMember, type Task } from "./bridge";
export function TeamPanel({ report }: { report: (s: string) => void }) {
  const [items, setItems] = useState<TeamMember[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [role, setRole] = useState("planner"),
    [job, setJob] = useState(""),
    [renames, setRenames] = useState<Record<string, string>>({});
  async function load() {
    if (team && local)
      try {
        setItems(await team.listTeam());
        setTasks(await local.listTasks());
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h2>A little team, led by Sebby.</h2>
      <p className="muted">
        Sebby gives each specialist a name and a clear job. Everyone inherits
        the same permission boundaries. Their real task state is shown below—no
        pretend background work.
      </p>
      <div className="callout">
        <h3>Coordinator: Sebby</h3>
        <p>
          Coordinates the plan and reviews specialist results before calling
          work done. AI coordination and execution are not connected yet; the
          team registry and task assignments are local and persistent.
        </p>
      </div>
      {!team ? (
        <p className="muted">
          Create and manage your named team in the desktop app.
        </p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Specialty
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="planner">Planning</option>
                <option value="coder">Development</option>
                <option value="reviewer">Review</option>
                <option value="researcher">Research</option>
              </select>
            </label>
            <label>
              Clear job
              <input
                value={job}
                maxLength={2000}
                onChange={(e) => setJob(e.target.value)}
              />
            </label>
          </div>
          <button
            className="primary spaced"
            onClick={async () => {
              try {
                await team!.createTeamMember({ role, job });
                setJob("");
                await load();
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <Plus size={16} />
            Let Sebby name a specialist
          </button>
          {!items.length && (
            <p className="muted">
              Your team is empty. Add a specialist when there’s a job worth
              delegating.
            </p>
          )}
          {items.map((member) => {
            const task = tasks.find((t) => t.id === member.assignedTaskId);
            return (
              <article className="skill" key={member.id}>
                <div className="skill-head">
                  <div>
                    <small>
                      {member.specialty} ·{" "}
                      {member.status === "retired"
                        ? "Retired"
                        : "AI executor not connected"}
                    </small>
                    <h3>
                      <Users size={17} /> {member.name}
                    </h3>
                    <p>{member.job}</p>
                    <small>
                      {member.nameOrigin === "sebby-assigned"
                        ? "Name assigned by Sebby · built-in name pool"
                        : "Name edited by you"}
                    </small>
                  </div>
                </div>
                {member.status !== "retired" && (
                  <>
                    <div className="form-grid">
                      <label>
                        Display name
                        <input
                          aria-label={`Rename ${member.name}`}
                          value={renames[member.id] ?? member.name}
                          onChange={(e) =>
                            setRenames({
                              ...renames,
                              [member.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                      <button
                        className="secondary align-bottom"
                        onClick={async () => {
                          try {
                            await team!.renameTeamMember({
                              id: member.id,
                              name: renames[member.id] ?? member.name,
                            });
                            await load();
                          } catch (e) {
                            report((e as Error).message);
                          }
                        }}
                      >
                        Save name
                      </button>
                    </div>
                    <label
                      className="field-label"
                      htmlFor={`task-${member.id}`}
                    >
                      Assigned task · assignment does not start execution
                    </label>
                    <select
                      id={`task-${member.id}`}
                      value={member.assignedTaskId || ""}
                      onChange={async (e) => {
                        try {
                          await team!.assignTeamTask({
                            id: member.id,
                            taskId: e.target.value || null,
                          });
                          await load();
                        } catch (error) {
                          report((error as Error).message);
                        }
                      }}
                    >
                      <option value="">No task assigned</option>
                      {tasks
                        .filter((t) => t.role === member.role)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title} · {t.status}
                          </option>
                        ))}
                    </select>
                    {task ? (
                      <div className="callout">
                        <h3>{task.title}</h3>
                        <p>
                          Task state: {task.status} · no executor currently
                          running
                        </p>
                        <p>{task.logs.at(-1)?.message}</p>
                      </div>
                    ) : (
                      <p className="muted">
                        No active task. No results produced.
                      </p>
                    )}
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await team!.retireTeamMember(member.id);
                          await load();
                        } catch (e) {
                          report((e as Error).message);
                        }
                      }}
                    >
                      Retire specialist…
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </>
      )}
    </>
  );
}
