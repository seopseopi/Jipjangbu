const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ko-KR", { granularity: "grapheme" })
  : null;

const normalizeSpaces = (value: string) => value.replace(/\s+/gu, " ").trim();

function characters(value: string): string[] {
  return segmenter
    ? Array.from(segmenter.segment(value), (part) => part.segment)
    : Array.from(value);
}

/** A short, read-only preview: show the matched passage, not just the first line. */
export function searchExcerpt(value: string | null | undefined, query: string, maxCharacters = 160): string {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) return "";
  const text = normalizeSpaces(value ?? "");
  if (text.length <= maxCharacters) return text;
  const parts = characters(text);
  if (parts.length <= maxCharacters) return text;

  // Keep a mapping because case folding can change a character's UTF-16 length.
  let folded = "";
  const offsets = parts.map((part) => {
    const offset = folded.length;
    folded += part.normalize("NFC").toLocaleLowerCase("ko-KR");
    return offset;
  });
  const term = normalizeSpaces(query).normalize("NFC").toLocaleLowerCase("ko-KR");
  const matchOffset = term ? folded.indexOf(term) : -1;
  let start = 0;
  if (matchOffset >= 0) {
    const afterStart = offsets.findIndex((offset) => offset > matchOffset);
    const matchStart = afterStart < 0 ? parts.length - 1 : afterStart - 1;
    const afterMatch = offsets.findIndex((offset) => offset >= matchOffset + term.length);
    const matchLength = (afterMatch < 0 ? parts.length : afterMatch) - matchStart;
    const before = Math.floor(Math.max(0, maxCharacters - matchLength) / 3);
    start = Math.max(0, matchStart - before);
  }
  const end = Math.min(parts.length, start + maxCharacters);
  if (matchOffset >= 0) start = Math.max(0, end - maxCharacters);
  return `${start > 0 ? "…" : ""}${parts.slice(start, end).join("").trim()}${end < parts.length ? "…" : ""}`;
}
