import { LocalExecutor } from "./local-executor.mjs";
export function installLocalExecutor({
  tasks,
  team,
  workspace,
  register,
  confirm,
}) {
  const executor = new LocalExecutor({
    tasks,
    team,
    workspace,
    approve: (request) =>
      confirm(
        "Run this local utility?",
        `${request.title}\nFolder: ${request.workspace}\nSpecialist label: ${request.member?.name || "Unassigned"}\n\n${request.notice}`,
      ),
  });
  register("start-local-utility", (input) => executor.startNew(input));
  register("review-local-utility", (taskId) =>
    executor.review(taskId, {
      approveReview: (request) =>
        confirm(
          "Accept this utility result?",
          `${request.title}\nFolder: ${request.workspace}\nReport SHA-256: ${request.sha256}\n\n${request.notice}\n\nRead the complete report in Sebby before confirming. This approves this specific local utility only.`,
        ),
    }),
  );
  return executor;
}
