export type QuoteTurn = { role: "agent" | "user"; content: string };
export type QuoteMatch = { turnIndex: number; start: number; end: number };

// Keep a position map so typographic quotes and whitespace can be normalized
// without altering the original text or highlighting an invented paraphrase.
function searchable(text: string) {
  let value = "";
  const starts: number[] = [], ends: number[] = [];
  let index = 0;
  for (const original of text) {
    let char = original.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    if (/\s/.test(char)) char = " ";
    if (char === " " && value.endsWith(" ")) { ends[ends.length - 1] = index + original.length; index += original.length; continue; }
    value += char;
    for (let unit = 0; unit < char.length; unit++) { starts.push(index); ends.push(index + original.length); }
    index += original.length;
  }
  return { value, starts, ends };
}

export function findCallerQuote(turns: QuoteTurn[], quote: string): QuoteMatch[] {
  const needle = searchable(quote).value.trim();
  if (!needle) return [];
  return turns.flatMap((turn, turnIndex) => {
    if (turn.role !== "user") return [];
    const haystack = searchable(turn.content);
    let index = haystack.value.indexOf(needle);
    const word = /[\p{L}\p{M}\p{N}_]/u;
    while (index >= 0) {
      const before = haystack.value[index - 1] ?? "", after = haystack.value[index + needle.length] ?? "";
      if ((!word.test(needle[0]) || !word.test(before)) && (!word.test(needle.at(-1)!) || !word.test(after))) {
        return [{ turnIndex, start: haystack.starts[index], end: haystack.ends[index + needle.length - 1] }];
      }
      index = haystack.value.indexOf(needle, index + 1);
    }
    return [];
  });
}
