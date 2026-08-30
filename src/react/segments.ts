import { parse, ParseError } from "../parser";
import type { QueryNode } from "../ast";

/**
 * Tolerant segmentation of a query string for editing UI.
 *
 * The parser is strict and throws on the first problem, which is the right
 * behaviour for a compiler and the wrong one for an input someone is halfway
 * through typing. This module re-walks the same lexical rules without ever
 * throwing, producing segments that tile the string end to end — every
 * character belongs to exactly one segment, so a render layer built from them
 * lines up glyph-for-glyph with the raw text.
 */

export type SegmentKind =
  /** A chip: a bare term, or a `field:value` filter, with optional `-`. */
  | "chip"
  /** A top-level `AND` / `OR`. Rendered as bare highlighted text. */
  | "operator"
  /** A top-level paren. Parens inside a filter value belong to the chip. */
  | "paren"
  | "space";

export interface Segment {
  kind: SegmentKind;
  /** Offsets into the query string; `[start, end)`. */
  start: number;
  end: number;
  text: string;
  /** Offset of the `:` within `text`, or `-1` when this is not a filter. */
  colon: number;
  /** True when the chip carries a leading `-`. */
  negated: boolean;
  /** Set when this segment is the one the parser rejected. */
  error?: string;
}

const WORD_TERMINATORS = ':()[]"<>';

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/** Scan one word, bare or quoted, honoring escapes. Returns the end offset. */
function scanWord(s: string, from: number): number {
  let i = from;
  if (s[i] === '"') {
    i++;
    while (i < s.length) {
      if (s[i] === "\\") {
        i += 2;
        continue;
      }
      if (s[i] === '"') return i + 1;
      i++;
    }
    return i;
  }
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (isSpace(ch) || WORD_TERMINATORS.includes(ch)) break;
    i++;
  }
  return i;
}

/** Scan a bracketed run to its matching close, or to end of input. */
function scanBalanced(
  s: string,
  from: number,
  open: string,
  close: string,
): number {
  let i = from;
  let depth = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      i = scanWord(s, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Scan the value side of a `field:`. */
function scanValue(s: string, from: number): number {
  if (from >= s.length) return from;
  const ch = s[from]!;
  if (ch === "(") return scanBalanced(s, from, "(", ")");
  if (ch === "[") return scanBalanced(s, from, "[", "]");
  if (ch === ">" || ch === "<") {
    let i = from + 1;
    if (s[i] === "=") i++;
    return scanValue(s, i);
  }
  if (ch === "@") {
    let i = from + 1;
    while (i < s.length && !isSpace(s[i]!) && s[i] !== ")" && s[i] !== "]") i++;
    return i;
  }
  return scanWord(s, from);
}

function make(
  kind: SegmentKind,
  text: string,
  start: number,
  end: number,
  colon = -1,
  negated = false,
): Segment {
  return { kind, start, end, text: text.slice(start, end), colon, negated };
}

/** Split a query string into renderable segments. Never throws. */
export function segment(query: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;

  while (i < query.length) {
    const ch = query[i]!;

    if (isSpace(ch)) {
      const start = i;
      while (i < query.length && isSpace(query[i]!)) i++;
      out.push(make("space", query, start, i));
      continue;
    }

    if (ch === "(" || ch === ")") {
      out.push(make("paren", query, i, i + 1));
      i++;
      continue;
    }

    const start = i;
    const negated = ch === "-";
    let cursor = negated ? i + 1 : i;
    const wordEnd = scanWord(query, cursor);
    const word = query.slice(cursor, wordEnd);

    if (
      !negated &&
      (word === "AND" || word === "OR") &&
      query[wordEnd] !== ":"
    ) {
      out.push(make("operator", query, start, wordEnd));
      i = wordEnd;
      continue;
    }

    let end = wordEnd;
    let colon = -1;
    if (query[end] === ":") {
      colon = end - start;
      end = scanValue(query, end + 1);
    }

    // A lone `-` with nothing after it is still a chip, just an empty one.
    if (end === start) end = start + 1;

    out.push(make("chip", query, start, end, colon, negated));
    i = end;
  }

  return out;
}

function normalizeGroupedOperators(value: string): string {
  let output = "";
  let index = 0;
  let quoted = false;

  while (index < value.length) {
    const char = value[index]!;
    if (char === "\\") {
      output += value.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      output += char;
      index++;
      continue;
    }
    if (!quoted && /[a-zA-Z]/.test(char)) {
      const start = index;
      while (index < value.length && /[a-zA-Z]/.test(value[index]!)) index++;
      const word = value.slice(start, index);
      const previous = value.slice(0, start).match(/\S(?=\s*$)/)?.[0];
      if (
        /^(and|or)$/i.test(word) &&
        previous !== undefined &&
        previous !== "("
      ) {
        output += word.toUpperCase();
      } else {
        output += word;
      }
      continue;
    }
    output += char;
    index++;
  }

  return output;
}

/** Normalize standalone boolean words without changing quoted or field values. */
export function normalizeOperators(query: string): string {
  const segments = segment(query);
  let output = "";

  for (const current of segments) {
    let text = current.text;
    if (
      current.kind === "chip" &&
      current.colon < 0 &&
      !current.negated &&
      /^(and|or)$/i.test(text)
    ) {
      text = text.toUpperCase();
    } else if (current.kind === "chip" && current.colon >= 0) {
      const valueStart = current.colon + 1;
      const value = text.slice(valueStart);
      if (value.startsWith("(")) {
        text = text.slice(0, valueStart) + normalizeGroupedOperators(value);
      }
    }
    output += text;
  }

  return output;
}

/** Result of validating a query: the tree when it parses, the fault when not. */
export interface Validation {
  ast: QueryNode | null;
  error: ParseError | null;
}

export function validate(query: string): Validation {
  if (query.trim() === "") return { ast: null, error: null };
  try {
    return { ast: parse(query), error: null };
  } catch (e) {
    if (e instanceof ParseError) return { ast: null, error: e };
    throw e;
  }
}

/**
 * Segment a query and mark the faulty segment, if any.
 *
 * A filter whose value is missing is flagged directly rather than waiting for
 * the parser, so `name:` reads as invalid the moment it is typed rather than
 * only once something follows it.
 */
export function segmentWithErrors(query: string): {
  segments: Segment[];
  validation: Validation;
} {
  const segments = segment(query);
  const validation = validate(query);

  for (const seg of segments) {
    if (seg.kind !== "chip") continue;
    if (seg.colon >= 0 && seg.colon === seg.text.length - 1) {
      seg.error = `"${seg.text.slice(seg.negated ? 1 : 0, seg.colon)}" has no value`;
    }
  }

  const fault = validation.error;
  if (fault) {
    const hit =
      segments.find(
        (s) => fault.position >= s.start && fault.position < s.end,
      ) ?? segments.filter((s) => s.kind === "chip").at(-1);
    if (hit && !hit.error) hit.error = fault.message;
  }

  return { segments, validation };
}

/* ------------------------------------------------------------------ */
/* Caret context — what the user is currently typing into              */
/* ------------------------------------------------------------------ */

export type CaretTarget =
  | { kind: "field"; fragment: string; field: null; replaceFrom: number }
  | { kind: "value"; fragment: string; field: string; replaceFrom: number };

/** Strip the punctuation a value fragment may be nested behind. */
function valueFragment(raw: string): { fragment: string; offset: number } {
  let i = 0;
  while (i < raw.length && "(<>=@[".includes(raw[i]!)) i++;
  // Only the text after the last separator is being typed.
  const rest = raw.slice(i);
  const sep = Math.max(rest.lastIndexOf(" "), rest.lastIndexOf('"'));
  const fragment = sep >= 0 ? rest.slice(sep + 1) : rest;
  return { fragment, offset: i + (sep >= 0 ? sep + 1 : 0) };
}

/**
 * What the caret is sitting in: a field name, or a value belonging to one.
 * Drives suggestions and is handed to `onChange` so callers can fetch the
 * right options.
 */
export function caretTarget(query: string, caret: number): CaretTarget {
  const segments = segment(query);
  const seg = segments.find((s) => caret > s.start && caret <= s.end);

  if (!seg || seg.kind === "space" || seg.kind === "paren") {
    return { kind: "field", fragment: "", field: null, replaceFrom: caret };
  }

  if (seg.kind === "operator") {
    return {
      kind: "field",
      fragment: seg.text.slice(0, caret - seg.start),
      field: null,
      replaceFrom: seg.start,
    };
  }

  const local = caret - seg.start;
  const head = seg.negated ? 1 : 0;

  if (seg.colon >= 0 && local > seg.colon) {
    const raw = seg.text.slice(seg.colon + 1, local);
    const { fragment, offset } = valueFragment(raw);
    return {
      kind: "value",
      fragment,
      field: seg.text.slice(head, seg.colon),
      replaceFrom: seg.start + seg.colon + 1 + offset,
    };
  }

  return {
    kind: "field",
    fragment: seg.text.slice(head, local),
    field: null,
    replaceFrom: seg.start + head,
  };
}
