import path from "node:path";
import fs from "node:fs/promises";
import { DevelopmentTools } from "./development.mjs";
export function installDevelopment({
  workspace,
  register,
  directory,
  confirm,
  chooseGit,
  reviewChange,
}) {
  const tools = new DevelopmentTools(workspace, {
    backupRoot: path.join(directory, "edit-backups"),
    approve: async (request, options = {}) => {
      if (request.kind === "run-command")
        return confirm(
          "Run this project command?",
          `${request.display}\nFolder: ${request.workspace}\nExecutable: ${request.executable}\n\n${request.warning}\n\n${request.scripts ? JSON.stringify(request.scripts, null, 2) : ""}`,
        );
      if (reviewChange && !(await reviewChange(request, options))) return false;
      return confirm(
        request.kind === "undo-edit"
          ? "Undo this file change?"
          : "Apply reviewed file change?",
        `File: ${request.path}\nFolder: ${request.workspace}\nOperation: ${request.kind === "undo-edit" ? (request.removesCreatedFile ? "DELETE the unchanged newly created file" : "restore original contents") : request.operation}\nContent hash: ${request.afterHash}\n\n${request.kind === "undo-edit" ? "Undo only succeeds if the file has not changed." : "This applies the previewed contents. A local backup is kept for existing files. Review the full change in Sebby before confirming."}`,
      );
    },
  });
  register("preview-edit", (input) => tools.previewEdit(input));
  register("discard-edit", (id) => ({ discarded: tools.discardProposal(id) }));
  register("apply-edit", (id) => tools.applyProposal(id));
  register("undo-edit", (id) => tools.undo(id));
  register("plan-command", (name) => tools.planCommand(name));
  register("discard-command", (id) => ({
    discarded: tools.discardCommand(id),
  }));
  register("start-command", (id) => {
    const { id: runId } = tools.startCommand(id);
    return { id: runId };
  });
  register("list-command-runs", () => tools.getRuns());
  register("cancel-command", (id) => ({ cancelled: tools.cancelCommand(id) }));
  register("configure-git", async () => {
    const selected = await chooseGit();
    if (!selected) return { configured: false };
    const canonical = await fs.realpath(selected);
    if (!(await fs.stat(canonical)).isFile())
      throw Error("Select a regular Git executable file.");
    if (!/^git(?:\.exe)?$/i.test(path.basename(canonical)))
      throw Error("Select the Git executable named git or git.exe.");
    if (
      !(await confirm(
        "Trust this Git executable?",
        `${canonical}\n\nOnly the fixed read-only status command is available. Choose an installation you trust. This selection is kept only for this session.`,
      ))
    )
      return { configured: false };
    tools.executables.git = canonical;
    return { configured: true };
  });
  return tools;
}
