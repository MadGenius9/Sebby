export const LANGUAGES = [
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["hi", "Hindi"],
  ["ur", "Urdu"],
  ["ar", "Arabic"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["ru", "Russian"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
] as const;
export function replyLanguage(): string {
  try {
    const code = localStorage.getItem("sebby.reply-language");
    return LANGUAGES.some(([id]) => id === code) ? code! : "en";
  } catch {
    return "en";
  }
}
