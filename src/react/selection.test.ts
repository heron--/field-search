// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  applySelection,
  readSelection,
  readText,
  stepBack,
  stepForward,
  toDomPoint,
  toModelOffset,
  wordBack,
  wordForward,
} from "./selection";

/** `kind:fruit apple`, shaped the way the editor renders it. */
function build(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = [
    '<span class="fs-chip">',
    '<span class="fs-field-name">kind</span>',
    '<span class="fs-punct">:</span>',
    "<span>fruit</span>",
    '<button data-fs-nontext="" aria-label="Remove kind:fruit">',
    "<span>close</span>",
    "</button>",
    "</span>",
    "<span> </span>",
    '<span class="fs-chip"><span>apple</span></span>',
  ].join("");
  document.body.append(root);
  return root;
}

describe("selection mapping", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = build();
  });

  it("reads the query text and skips non-text subtrees", () => {
    expect(readText(root)).toBe("kind:fruit apple");
  });

  it("round-trips every offset in the string", () => {
    const value = readText(root);
    for (let offset = 0; offset <= value.length; offset++) {
      const point = toDomPoint(root, offset);
      expect(toModelOffset(root, point.node, point.offset)).toBe(offset);
    }
  });

  it("resolves a boundary offset to the end of the earlier node", () => {
    // Offset 4 is both the end of "kind" and the start of ":".
    const point = toDomPoint(root, 4);
    expect(point.node.nodeValue).toBe("kind");
    expect(point.offset).toBe(4);
  });

  it("maps an element boundary by the text that precedes it", () => {
    const secondChip = root.querySelectorAll(".fs-chip")[1]!;
    expect(toModelOffset(root, secondChip, 0)).toBe("kind:fruit ".length);
  });

  it("counts no offsets for a non-text subtree", () => {
    const button = root.querySelector("button")!;
    // The remove control sits between "fruit" and the following space.
    expect(toModelOffset(root, button, 0)).toBe("kind:fruit".length);
    expect(toModelOffset(root, button.firstChild!, 3)).toBe(
      "kind:fruit".length,
    );
  });

  it("clamps an offset past the end of the text", () => {
    const point = toDomPoint(root, 500);
    expect(toModelOffset(root, point.node, point.offset)).toBe(16);
  });

  it("treats an empty editor as offset zero", () => {
    const empty = document.createElement("div");
    document.body.append(empty);
    const point = toDomPoint(empty, 0);
    expect(point.node).toBe(empty);
    expect(toModelOffset(empty, point.node, point.offset)).toBe(0);
  });

  it("writes and reads back a ranged selection", () => {
    applySelection(root, { anchor: 2, focus: 9 });
    expect(readSelection(root)).toEqual({ anchor: 2, focus: 9 });
  });

  it("ignores a selection outside the editor", () => {
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 2);

    expect(readSelection(root)).toBeNull();
  });
});

describe("offset arithmetic", () => {
  it("steps whole grapheme clusters", () => {
    const value = "a👍🏽b";
    expect(stepBack(value, value.length)).toBe(value.length - 1);
    expect(stepBack(value, value.length - 1)).toBe(1);
    expect(stepForward(value, 1)).toBe(value.length - 1);
  });

  it("stops at the ends of the string", () => {
    expect(stepBack("abc", 0)).toBe(0);
    expect(stepForward("abc", 3)).toBe(3);
  });

  it("steps over whitespace to reach a word boundary", () => {
    const value = "kind:fruit apple";
    expect(wordBack(value, value.length)).toBe(11);
    expect(wordBack(value, 11)).toBe(0);
    expect(wordForward(value, 10)).toBe(16);
  });
});
