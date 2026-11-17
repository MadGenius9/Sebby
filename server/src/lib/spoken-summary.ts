// Use an extractive summary so voice does not add claims or require a second model call.
export function spokenSummary(markdown: string): string {
  const prose = markdown
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*(?:`{3,}|~{3,})[^\n]*$|(?![\s\S]))/gm, '')
    .replace(/^[ \t]{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/\[(?:pause|long-pause|hum-tune|laugh|chuckle|giggle|cry|tsk|tongue-click|lip-smack|breath|inhale|exhale|sigh)\]/gi, '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prose) return '';
  let summary = '';
  let count = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(prose)) {
    summary += part.segment;
    if (++count === 2) break;
  }
  summary = summary.trim();
  if (summary.length <= 320) return summary;
  const cut = summary.slice(0, 319);
  return (cut.lastIndexOf(' ') > 220 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trimEnd() + '…';
}
