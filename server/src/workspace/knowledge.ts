import { createHash } from "node:crypto";
import type { Project, KnowledgeHit } from "./schema.js";
export const KNOWLEDGE_FILES = [
  "SEBBY.md",
  "docs/requirements.md",
  "docs/decisions.md",
] as const;
export function projectKnowledge(project: Project) {
  return KNOWLEDGE_FILES.flatMap((path) => {
    const file = project.files.find((f) => f.path === path);
    return file
      ? [
          {
            path,
            characters: file.content.length,
            sha256: createHash("sha256").update(file.content).digest("hex"),
          },
        ]
      : [];
  });
}
export function searchProject(
  project: Project,
  query: string,
): { revision: number; hits: KnowledgeHit[] } {
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []),
  ].slice(0, 12);
  if (!terms.length) return { revision: project.revision, hits: [] };
  const hits: KnowledgeHit[] = [];
  const compare = (a: KnowledgeHit, b: KnowledgeHit) =>
    b.score - a.score ||
    a.path.localeCompare(b.path) ||
    a.startLine - b.startLine;
  for (const file of project.files) {
    const lines = file.content.split("\n"),
      sha256 = createHash("sha256").update(file.content).digest("hex");
    const used = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].toLowerCase(),
        matched = terms.filter((term) => text.includes(term));
      if (!matched.length || used.has(i)) continue;
      const start = Math.max(0, i - 1),
        end = Math.min(lines.length - 1, i + 1);
      for (let j = start; j <= end; j++) used.add(j);
      hits.push({
        path: file.path,
        startLine: start + 1,
        endLine: end + 1,
        snippet: lines
          .slice(start, end + 1)
          .map((line, offset) => {
            const found =
              offset + start === i
                ? Math.min(
                    ...matched
                      .map((t) => line.toLowerCase().indexOf(t))
                      .filter((n) => n >= 0),
                  )
                : 0;
            const from = Math.max(0, found - 160);
            return (
              (from ? "…" : "") +
              line.slice(from, from + 480) +
              (line.length > from + 480 ? "…" : "")
            );
          })
          .join("\n"),
        sha256,
        score:
          matched.length +
          (KNOWLEDGE_FILES.some((p) => p === file.path) ? 1 : 0),
      });
      if (hits.length > 40) {
        hits.sort(compare);
        hits.length = 20;
      }
    }
  }
  hits.sort(compare);
  return { revision: project.revision, hits: hits.slice(0, 20) };
}
