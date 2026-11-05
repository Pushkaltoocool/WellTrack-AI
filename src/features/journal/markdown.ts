/**
 * The journal's tiny formatting language, kept as plain text so entries stay portable:
 * line prefixes "# " title, "## " heading, "### " subheading, "> " quote; inline **bold**,
 * *italic*, __underline__ and ~~strike~~. The editor renders it live; reading views hide markers.
 */
export type Block = 'title' | 'heading' | 'subheading' | 'quote' | 'body';
export type InlineMark = 'bold' | 'italic' | 'underline' | 'strike';

export interface Span {
  text: string;
  /** Formatting characters (shown faint while editing, hidden when reading). */
  marker?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface ParsedLine {
  block: Block;
  prefix: string;
  spans: Span[];
}

const PREFIXES: [Block, string][] = [
  ['subheading', '### '],
  ['heading', '## '],
  ['title', '# '],
  ['quote', '> '],
];
export const MARKERS: Record<InlineMark, string> = { bold: '**', italic: '*', underline: '__', strike: '~~' };
const INLINE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\*[^*\n]+?\*)/g;

export function parseLine(line: string): ParsedLine {
  const hit = PREFIXES.find(([, p]) => line.startsWith(p));
  const block: Block = hit ? hit[0] : 'body';
  const prefix = hit ? hit[1] : '';
  const rest = line.slice(prefix.length);
  const spans: Span[] = [];
  let last = 0;
  for (const m of rest.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) spans.push({ text: rest.slice(last, i) });
    const tok = m[0];
    const mark: InlineMark = tok.startsWith('**') ? 'bold' : tok.startsWith('__') ? 'underline' : tok.startsWith('~~') ? 'strike' : 'italic';
    const len = MARKERS[mark].length;
    spans.push({ text: tok.slice(0, len), marker: true });
    spans.push({ text: tok.slice(len, tok.length - len), [mark]: true });
    spans.push({ text: tok.slice(tok.length - len), marker: true });
    last = i + tok.length;
  }
  if (last < rest.length) spans.push({ text: rest.slice(last) });
  return { block, prefix, spans };
}

export function parseDocument(text: string): ParsedLine[] {
  return text.split('\n').map(parseLine);
}

/** Plain text without formatting markers — for analysis, previews and word counts. */
export function stripMarkdown(text: string): string {
  return parseDocument(text)
    .map((l) => l.spans.filter((s) => !s.marker).map((s) => s.text).join(''))
    .join('\n');
}

function lineBounds(text: string, cursor: number): [number, number] {
  const start = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const nl = text.indexOf('\n', cursor);
  return [start, nl === -1 ? text.length : nl];
}

/** Block style of the line containing `cursor`. */
export function blockAt(text: string, cursor: number): Block {
  const [s, e] = lineBounds(text, cursor);
  return parseLine(text.slice(s, e)).block;
}

/** Sets the block style of the line containing `cursor`; returns the new text and cursor. */
export function setBlock(text: string, cursor: number, block: Block): { text: string; cursor: number } {
  const [s, e] = lineBounds(text, cursor);
  const line = text.slice(s, e);
  const { prefix } = parseLine(line);
  const nextPrefix = block === 'body' ? '' : (PREFIXES.find(([b]) => b === block)?.[1] ?? '');
  const next = nextPrefix + line.slice(prefix.length);
  return { text: text.slice(0, s) + next + text.slice(e), cursor: Math.max(s + nextPrefix.length, cursor + nextPrefix.length - prefix.length) };
}

/**
 * Wraps the selection in `mark` (or unwraps it if already wrapped). With an empty selection,
 * inserts an empty pair and places the cursor between the markers.
 */
export function toggleInline(text: string, sel: { start: number; end: number }, mark: InlineMark): { text: string; selection: { start: number; end: number } } {
  const m = MARKERS[mark];
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  if (text.slice(start - m.length, start) === m && text.slice(end, end + m.length) === m && !(mark === 'italic' && (text[start - 2] === '*' || text[end + 1] === '*'))) {
    return {
      text: text.slice(0, start - m.length) + text.slice(start, end) + text.slice(end + m.length),
      selection: { start: start - m.length, end: end - m.length },
    };
  }
  return {
    text: text.slice(0, start) + m + text.slice(start, end) + m + text.slice(end),
    selection: { start: start + m.length, end: end + m.length },
  };
}

/** Tags are stored as a comma-separated lower-case list. */
export function parseTags(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 12);
}
export const formatTags = (tags: string[]) => parseTags(tags.join(',')).join(',');
