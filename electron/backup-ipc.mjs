import fs from "node:fs/promises";
/** Native-only paths; no renderer-selected arbitrary filesystem targets. */
export function installBackup({
  backup,
  register,
  dialog,
  getWindow,
  confirm,
  quiesce,
  restart,
}) {
  register("export-backup", async () => {
    if (
      !(await confirm(
        "Export a plaintext local backup?",
        "This includes memory, prompts, drafts, tasks, reminders, connector bookmarks and local paths. It excludes credential vaults and project files. Keep it private.",
      ))
    )
      return { exported: false };
    const payload = await backup.exportJSON();
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "Export Sebby local backup",
      defaultPath: `Sebby-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { exported: false };
    await fs.writeFile(result.filePath, payload, { flag: "wx", mode: 0o600 });
    return { exported: true };
  });
  register("preview-backup-import", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Preview a Sebby backup",
      properties: ["openFile"],
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0],
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
      throw Error("Choose a regular JSON backup no larger than 20 MiB.");
    return backup.previewImport(await fs.readFile(file, "utf8"));
  });
  register("restore-backup", async (token) => {
    const result = await backup.restore(token, {
      approve: (summary) =>
        confirm(
          "Replace local data and restart Sebby?",
          `Replace these local stores:\n${summary.map((x) => x.name).join("\n")}\n\nThis does not restore project files. Existing local stores are retained in a recovery folder. Sebby will restart after success.`,
        ),
      quiesce,
    });
    if (result.restored) restart();
    return {
      restored: result.restored,
      restartRequired: result.restartRequired || false,
    };
  });
}
