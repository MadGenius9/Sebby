// English wake phrase matching is deliberately bounded to the start of a turn.
// Whisper commonly renders the proper name as Sebi; no arbitrary fuzzy matches.
export function wakeTurn(text: string, awake: boolean) {
  const normalized = text.trim().replace(/^[\s,.!?]+/, "");
  if (/^(?:stop listening|disable hands[ -]free)[.!?]*$/i.test(normalized))
    return { kind: "disable" as const, text: "" };
  const wake =
    /^(?:hello|hey)[,\s]+(?:sebby|sebi|sebbi|sebbie|seby)\b[\s,.!?:;-]*/i;
  const matched = wake.test(normalized);
  if (!matched && !awake) return { kind: "ignore" as const, text: "" };
  const command = (matched ? normalized.replace(wake, "") : normalized).trim();
  if (
    /^(?:stop listening|disable hands free|disable hands-free)[.!?]*$/i.test(
      command,
    )
  )
    return { kind: "disable" as const, text: "" };
  if (/^(?:go to sleep|goodbye(?: sebby| sebi)?)[.!?]*$/i.test(command))
    return { kind: "sleep" as const, text: "" };
  if (/^(?:stop|cancel|be quiet)[.!?]*$/i.test(command))
    return { kind: "interrupt" as const, text: "" };
  return {
    kind: "turn" as const,
    text: command || "Hello Sebby. Please greet me briefly.",
  };
}

export class TurnDetector {
  heard = false;
  lastSpeech = 0;
  sustained = 0;
  start = 0;
  reset(now: number) {
    this.heard = false;
    this.sustained = 0;
    this.start = now;
    this.lastSpeech = now;
  }
  sample(rms: number, now: number) {
    if (rms > 0.025) {
      this.sustained++;
      if (this.sustained >= 3) this.heard = true;
      this.lastSpeech = now;
    } else this.sustained = 0;
    return {
      interrupt: this.sustained === 3,
      finish:
        (this.heard && now - this.lastSpeech > 900) ||
        now - this.start > (this.heard ? 15000 : 4000),
    };
  }
}
