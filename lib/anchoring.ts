export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}
export interface TextRange {
  start: number;
  end: number;
}

const CONTEXT = 32;

export function buildQuote(text: string, start: number, end: number): Quote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT)),
  };
}

/** Locate the quote in `text`. Exact-unique → that range; repeated → best context match; absent → null. */
export function locate(text: string, quote: Quote): TextRange | null {
  if (!quote.exact) return null;
  const occurrences = indexesOf(text, quote.exact);
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + quote.exact.length };
  }
  let best: { idx: number; score: number } | null = null;
  for (const idx of occurrences) {
    const pre = text.slice(Math.max(0, idx - quote.prefix.length), idx);
    const suf = text.slice(idx + quote.exact.length, idx + quote.exact.length + quote.suffix.length);
    const score = commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix);
    if (!best || score > best.score) best = { idx, score };
  }
  return best ? { start: best.idx, end: best.idx + quote.exact.length } : null;
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
