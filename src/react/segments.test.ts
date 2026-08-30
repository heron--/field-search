import { describe, expect, it } from "vitest";
import {
  caretTarget,
  normalizeOperators,
  segment,
  segmentWithErrors,
} from "./segments";

/** Compact view: kind initial + text, so expectations read as the input does. */
const sketch = (query: string) =>
  segment(query).map((s) => `${s.kind[0]}:${s.text}`);

/** Segments must tile the string exactly — the render layer depends on it. */
function assertTiles(query: string) {
  const segs = segment(query);
  expect(segs.map((s) => s.text).join("")).toBe(query);
  let cursor = 0;
  for (const s of segs) {
    expect(s.start).toBe(cursor);
    cursor = s.end;
  }
  expect(cursor).toBe(query.length);
}

describe("segment", () => {
  it("makes a chip from a bare word", () => {
    expect(sketch("apple")).toEqual(["c:apple"]);
  });

  it("makes a chip per juxtaposed word", () => {
    expect(sketch("apple pear")).toEqual(["c:apple", "s: ", "c:pear"]);
  });

  it("makes one chip from a filter", () => {
    expect(sketch("kind:fruit")).toEqual(["c:kind:fruit"]);
  });

  it("keeps a negated filter in one chip", () => {
    expect(sketch("-kind:fruit")).toEqual(["c:-kind:fruit"]);
    expect(segment("-kind:fruit")[0]!.negated).toBe(true);
  });

  it("records the colon offset for highlighting", () => {
    const [chip] = segment("kind:fruit");
    expect(chip!.colon).toBe(4);
    expect(chip!.text[chip!.colon]).toBe(":");
  });

  it("reports no colon for a bare term", () => {
    expect(segment("apple")[0]!.colon).toBe(-1);
  });

  it("leaves top-level parens outside chips", () => {
    expect(sketch("(a b c)")).toEqual([
      "p:(",
      "c:a",
      "s: ",
      "c:b",
      "s: ",
      "c:c",
      "p:)",
    ]);
  });

  it("absorbs a parenthesized value into the filter chip", () => {
    expect(sketch("kind:(a b c)")).toEqual(["c:kind:(a b c)"]);
  });

  it("absorbs a bracketed range into the filter chip", () => {
    expect(sketch("calories:[10 TO 90]")).toEqual(["c:calories:[10 TO 90]"]);
  });

  it("absorbs a comparison into the filter chip", () => {
    expect(sketch("calories:>=90")).toEqual(["c:calories:>=90"]);
  });

  it("absorbs a datetime into the filter chip", () => {
    expect(sketch("harvested:>@2024-01-15")).toEqual([
      "c:harvested:>@2024-01-15",
    ]);
  });

  it("treats top-level AND and OR as operators, not chips", () => {
    expect(sketch("a AND b OR c")).toEqual([
      "c:a",
      "s: ",
      "o:AND",
      "s: ",
      "c:b",
      "s: ",
      "o:OR",
      "s: ",
      "c:c",
    ]);
  });

  it("treats a field literally named AND as a chip", () => {
    expect(sketch("AND:x")).toEqual(["c:AND:x"]);
  });

  it("keeps a quoted value with spaces in one chip", () => {
    expect(sketch('name:"granny smith"')).toEqual(['c:name:"granny smith"']);
  });

  it("keeps a bare quoted string in one chip", () => {
    expect(sketch('"granny smith"')).toEqual(['c:"granny smith"']);
  });

  it("keeps an escaped space inside a chip", () => {
    expect(sketch("name:granny\\ smith")).toEqual(["c:name:granny\\ smith"]);
  });

  it("tolerates an unterminated quote", () => {
    expect(sketch('name:"granny')).toEqual(['c:name:"granny']);
  });

  it("tolerates an unclosed paren", () => {
    expect(sketch("kind:(a b")).toEqual(["c:kind:(a b"]);
  });

  it("tolerates a lone hyphen", () => {
    expect(sketch("-")).toEqual(["c:-"]);
  });

  it("tolerates a trailing colon", () => {
    expect(sketch("kind:")).toEqual(["c:kind:"]);
  });
});

describe("segments tile the input", () => {
  it.each([
    "",
    "apple",
    "a b c",
    "kind:fruit color:red",
    "(a b) OR kind:nut",
    'name:"granny smith" -kind:herb',
    "calories:[10 TO 90] harvested:>@2024-01-15",
    "   leading and trailing   ",
    "kind:(a OR b) x",
    'unterminated:"quote',
    "-",
    "kind:",
  ])("tiles %j", (query) => assertTiles(query));
});

describe("segmentWithErrors", () => {
  it("flags a filter with no value", () => {
    const { segments } = segmentWithErrors("kind:");
    expect(segments[0]!.error).toMatch(/no value/);
  });

  it("flags a negated filter with no value", () => {
    const { segments } = segmentWithErrors("-kind:");
    expect(segments[0]!.error).toMatch(/kind/);
  });

  it("flags the segment the parser rejected", () => {
    const { segments } = segmentWithErrors("kind:fruit color:(");
    const flagged = segments.filter((s) => s.error);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.text).toBe("color:(");
  });

  it("leaves a valid query unflagged", () => {
    const { segments, validation } = segmentWithErrors("kind:fruit -color:red");
    expect(segments.some((s) => s.error)).toBe(false);
    expect(validation.ast).not.toBeNull();
    expect(validation.error).toBeNull();
  });

  it("returns a null ast without an error for empty input", () => {
    expect(segmentWithErrors("   ").validation).toEqual({
      ast: null,
      error: null,
    });
  });

  it("exposes the parsed tree for a valid query", () => {
    const { validation } = segmentWithErrors("kind:fruit");
    expect(validation.ast?.type).toBe("Query");
    expect(validation.ast?.children).toHaveLength(1);
  });
});

describe("normalizeOperators", () => {
  it("uppercases standalone lowercase boolean operators", () => {
    expect(normalizeOperators("kind:fruit and colors:green or tropical")).toBe(
      "kind:fruit AND colors:green OR tropical",
    );
  });

  it("uppercases boolean operators inside grouped values", () => {
    expect(normalizeOperators("colors:(red and blue or green)")).toBe(
      "colors:(red AND blue OR green)",
    );
  });

  it("does not change quoted text or ordinary field values", () => {
    expect(normalizeOperators('name:and note:"red and blue"')).toBe(
      'name:and note:"red and blue"',
    );
  });
});

describe("caretTarget", () => {
  /** `|` marks the caret. */
  const at = (marked: string) => {
    const caret = marked.indexOf("|");
    return caretTarget(marked.replace("|", ""), caret);
  };

  it("reads a field fragment mid-word", () => {
    expect(at("kin|")).toMatchObject({ kind: "field", fragment: "kin" });
  });

  it("reads a field fragment on a negated chip", () => {
    expect(at("-kin|")).toMatchObject({ kind: "field", fragment: "kin" });
  });

  it("switches to value context after the colon", () => {
    expect(at("kind:|")).toMatchObject({
      kind: "value",
      field: "kind",
      fragment: "",
    });
  });

  it("reads a partial value", () => {
    expect(at("kind:fru|")).toMatchObject({
      kind: "value",
      field: "kind",
      fragment: "fru",
    });
  });

  it("reads a value inside a group", () => {
    expect(at("kind:(fru|")).toMatchObject({
      kind: "value",
      field: "kind",
      fragment: "fru",
    });
  });

  it("reads the last value of an OR list", () => {
    expect(at("kind:(fruit OR nu|")).toMatchObject({
      kind: "value",
      field: "kind",
      fragment: "nu",
    });
  });

  it("reads a value behind a comparison operator", () => {
    expect(at("calories:>9|")).toMatchObject({
      kind: "value",
      field: "calories",
      fragment: "9",
    });
  });

  it("reads a value inside quotes", () => {
    expect(at('name:"gran|')).toMatchObject({
      kind: "value",
      field: "name",
      fragment: "gran",
    });
  });

  it("uses the field of the chip the caret sits in, not an earlier one", () => {
    expect(at("kind:fruit color:re|")).toMatchObject({
      kind: "value",
      field: "color",
      fragment: "re",
    });
  });

  it("falls back to field context in whitespace", () => {
    expect(at("kind:fruit |")).toMatchObject({
      kind: "field",
      fragment: "",
      field: null,
    });
  });

  it("falls back to field context on an empty query", () => {
    expect(at("|")).toMatchObject({ kind: "field", fragment: "", field: null });
  });

  it("points replaceFrom at the start of the fragment", () => {
    const target = at("kind:fru|");
    expect(target.replaceFrom).toBe("kind:".length);
  });

  it("points replaceFrom past a group opener", () => {
    const target = at("kind:(fru|");
    expect(target.replaceFrom).toBe("kind:(".length);
  });

  it("points replaceFrom at the start of a field fragment", () => {
    expect(at("kind:fruit co|").replaceFrom).toBe("kind:fruit ".length);
  });
});
