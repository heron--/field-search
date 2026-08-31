/**
 * Mapping between model offsets and DOM positions inside the editable field.
 *
 * The editor renders segments that tile the query string end to end, so the
 * concatenated data of its text nodes is exactly the query string. Every
 * function here rests on that invariant: it is what lets a caret be expressed
 * as a plain integer offset even though the DOM is a tree of nested spans.
 *
 * Subtrees marked `data-fs-nontext` — remove controls, icons, anything that is
 * chrome rather than query text — are skipped on the way in and on the way out,
 * so they can be nested inside a chip without shifting a single offset.
 */

/** A model-space selection. Collapsed when `anchor === focus`. */
export interface EditorSelection {
  /** Where the selection started; may be after `focus` when dragged backwards. */
  anchor: number;
  /** Where the caret is. */
  focus: number;
}

export function collapsed(offset: number): EditorSelection {
  return { anchor: offset, focus: offset };
}

/** Normalize a selection to `[start, end)` order. */
export function ordered(selection: EditorSelection): {
  start: number;
  end: number;
} {
  return {
    start: Math.min(selection.anchor, selection.focus),
    end: Math.max(selection.anchor, selection.focus),
  };
}

function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  if (typeof document === "undefined") return out;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        return (node as Element).hasAttribute("data-fs-nontext")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    out.push(node as Text);
  }
  return out;
}

/** The query string as the DOM currently holds it. */
export function readText(root: HTMLElement): string {
  let out = "";
  for (const node of textNodes(root)) out += node.data;
  return out;
}

/**
 * Model offset for a DOM point.
 *
 * A point inside a text node is the common case and resolves directly. A point
 * on an element — which is what a `(container, childIndex)` boundary is —
 * resolves by measuring the text that precedes it.
 */
export function toModelOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
): number {
  const nodes = textNodes(root);
  let base = 0;
  for (const node of nodes) {
    if (node === container) return base + Math.min(offset, node.data.length);
    base += node.data.length;
  }

  // An element boundary. Reduce it to a node, then count what comes first.
  let boundary: Node = container;
  let inside = true;
  if (container.nodeType === Node.ELEMENT_NODE) {
    const children = container.childNodes;
    if (offset < children.length) {
      boundary = children[offset]!;
      inside = false;
    }
  }

  let total = 0;
  for (const node of nodes) {
    if (node === boundary || boundary.contains(node)) {
      if (!inside) break;
      total += node.data.length;
      continue;
    }
    const relation = boundary.compareDocumentPosition(node);
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
      total += node.data.length;
      continue;
    }
    break;
  }
  return total;
}

/**
 * DOM point for a model offset.
 *
 * An offset sitting exactly on a boundary between two segments is ambiguous.
 * It resolves to the end of the earlier text node, which is where a browser
 * leaves the caret after typing and keeps the caret visually attached to the
 * text just entered.
 */
export function toDomPoint(
  root: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  const nodes = textNodes(root);
  if (nodes.length === 0) return { node: root, offset: 0 };
  let base = 0;
  for (const node of nodes) {
    const end = base + node.data.length;
    if (offset <= end) return { node, offset: Math.max(0, offset - base) };
    base = end;
  }
  const last = nodes[nodes.length - 1]!;
  return { node: last, offset: last.data.length };
}

/** The current document selection in model space, or null when it is elsewhere. */
export function readSelection(
  root: HTMLElement | null,
): EditorSelection | null {
  if (!root || typeof document === "undefined") return null;
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode) return null;
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;
  return {
    anchor: toModelOffset(root, anchorNode, anchorOffset),
    focus: toModelOffset(root, focusNode, focusOffset),
  };
}

/** Model-space equivalent of a `beforeinput` target range. */
export function toModelRange(
  root: HTMLElement,
  range: StaticRange | Range,
): EditorSelection {
  return {
    anchor: toModelOffset(root, range.startContainer, range.startOffset),
    focus: toModelOffset(root, range.endContainer, range.endOffset),
  };
}

/** Place the document selection at a model-space selection. */
export function applySelection(
  root: HTMLElement,
  selection: EditorSelection,
): void {
  const document = root.ownerDocument;
  const current = document.getSelection();
  if (!current) return;
  const anchor = toDomPoint(root, selection.anchor);
  const focus = toDomPoint(root, selection.focus);

  if (typeof current.setBaseAndExtent === "function") {
    current.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
    return;
  }

  // Ranges are always forward, so a backwards selection loses its direction.
  const { start, end } = ordered(selection);
  const first = toDomPoint(root, start);
  const last = toDomPoint(root, end);
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  current.removeAllRanges();
  current.addRange(range);
}

/* ------------------------------------------------------------------ */
/* Offset arithmetic for edits the browser did not hand us a range for */
/* ------------------------------------------------------------------ */

const graphemes =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** One grapheme back, so a delete never splits a cluster or a surrogate pair. */
export function stepBack(value: string, offset: number): number {
  if (offset <= 0) return 0;
  const head = value.slice(0, offset);
  if (graphemes) {
    let last = 0;
    for (const { index } of graphemes.segment(head)) last = index;
    return last;
  }
  const characters = [...head];
  return offset - (characters[characters.length - 1]?.length ?? 1);
}

/** One grapheme forward. */
export function stepForward(value: string, offset: number): number {
  if (offset >= value.length) return value.length;
  const tail = value.slice(offset);
  if (graphemes) {
    const first = graphemes.segment(tail)[Symbol.iterator]().next();
    if (!first.done) return offset + first.value.segment.length;
  }
  return offset + ([...tail][0]?.length ?? 1);
}

/** Start of the word before `offset`, skipping any whitespace first. */
export function wordBack(value: string, offset: number): number {
  let index = offset;
  while (index > 0 && /\s/.test(value[index - 1]!)) index--;
  while (index > 0 && !/\s/.test(value[index - 1]!)) index--;
  return index;
}

/** End of the word after `offset`, skipping any whitespace first. */
export function wordForward(value: string, offset: number): number {
  let index = offset;
  while (index < value.length && /\s/.test(value[index]!)) index++;
  while (index < value.length && !/\s/.test(value[index]!)) index++;
  return index;
}
