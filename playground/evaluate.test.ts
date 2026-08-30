import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { PRODUCE } from "./data";
import { filterRecords } from "./evaluate";

/** Sorted names of the records a query string selects. */
function names(query: string): string[] {
  return filterRecords(parse(query), PRODUCE)
    .map((record) => record.name)
    .sort();
}

describe("filters", () => {
  it("matches a scalar field", () => {
    expect(names("kind:legume")).toEqual([
      "black bean",
      "chickpea",
      "edamame",
      "green bean",
      "pea",
      "red lentil",
    ]);
  });

  it("matches a quoted multi-word value", () => {
    expect(names('name:"granny smith"')).toEqual(["granny smith"]);
  });

  it("matches any element of a multi-valued field", () => {
    expect(names("kind:vegetable colors:red")).toEqual([
      "beetroot",
      "bell pepper red",
      "radish",
    ]);
    expect(names("kind:nut tags:organic")).toEqual(["almond", "hazelnut"]);
  });

  it("evaluates an unknown field to false instead of throwing", () => {
    expect(() => names("nope:x")).not.toThrow();
    expect(names("nope:x")).toEqual([]);
    expect(names("kind:fruit nope:x")).toEqual([]);
  });
});

describe("query-level operators", () => {
  it("combines juxtaposed expressions with AND", () => {
    expect(names("kind:fruit tags:citrus")).toEqual([
      "grapefruit",
      "lemon",
      "lime",
      "mandarin",
      "orange",
    ]);
    expect(names("kind:fruit tags:citrus origin:spain")).toEqual(["orange"]);
  });

  it("combines juxtaposed expressions inside a group with AND", () => {
    expect(names("(kind:herb colors:green) tags:aromatic")).toEqual([
      "mint",
      "rosemary",
      "thyme",
    ]);
  });

  it("requires every operand of an explicit AND", () => {
    expect(names("origin:italy AND kind:fruit")).toEqual(["grape", "lemon"]);
  });

  it("accepts any operand of an OR", () => {
    expect(names("origin:wales OR origin:scotland")).toEqual([
      "kale",
      "leek",
      "turnip",
    ]);
  });

  it("negates with -", () => {
    expect(names("origin:italy")).toEqual([
      "basil",
      "grape",
      "lemon",
      "spinach",
      "zucchini",
    ]);
    expect(names("origin:italy -kind:fruit")).toEqual([
      "basil",
      "spinach",
      "zucchini",
    ]);
  });

  it("lets a group override AND binding tighter than OR", () => {
    expect(names("(kind:nut OR kind:legume) AND colors:green")).toEqual([
      "edamame",
      "green bean",
      "pea",
      "pistachio",
    ]);
    expect(names("kind:nut OR kind:legume AND colors:green")).toEqual([
      "almond",
      "cashew",
      "edamame",
      "green bean",
      "hazelnut",
      "pea",
      "peanut",
      "pistachio",
      "walnut",
    ]);
  });
});

describe("bare terms", () => {
  it("searches every field", () => {
    expect(names("citrus")).toEqual([
      "grapefruit",
      "lemon",
      "lime",
      "mandarin",
      "orange",
    ]);
    expect(names("vietnam")).toEqual(["cashew", "dragon fruit"]);
  });
});

describe("wildcards", () => {
  it("matches a shared suffix", () => {
    expect(names("name:*berry")).toEqual([
      "blackberry",
      "blueberry",
      "cranberry",
      "elderberry",
      "raspberry",
      "strawberry",
    ]);
  });

  it("matches a shared prefix", () => {
    expect(names("name:pea*")).toEqual([
      "pea",
      "peach",
      "peanut",
      "pear",
      "pearl onion",
    ]);
  });

  it("matches across an escaped space", () => {
    expect(names("name:bell\\ *")).toEqual([
      "bell pepper green",
      "bell pepper red",
      "bell pepper yellow",
    ]);
  });

  it("treats an escaped star as a literal star", () => {
    expect(names("name:star*fruit")).toEqual(["star fruit"]);
    expect(names("name:star\\*fruit")).toEqual([]);
  });
});

describe("numbers", () => {
  it("matches numeric equality", () => {
    expect(names("calories:52")).toEqual(["apple", "raspberry"]);
  });

  it("substring-matches a quoted value against a numeric field", () => {
    expect(names('calories:"52"')).toEqual(["apple", "raspberry"]);
  });

  it("compares with > and <", () => {
    expect(names("kind:herb calories:>100")).toEqual([
      "rosemary",
      "saffron",
      "thyme",
    ]);
    expect(names("price:<0.50")).toEqual(["banana", "lime", "potato"]);
    expect(names("grams:>2000")).toEqual(["watermelon"]);
  });

  it("treats range bounds as inclusive", () => {
    expect(names("kind:nut calories:[560 TO 600]")).toEqual([
      "almond",
      "peanut",
      "pistachio",
    ]);
    expect(names("kind:nut calories:[553 TO 560]")).toEqual([
      "cashew",
      "pistachio",
    ]);
  });
});

describe("datetimes", () => {
  it("compares against a date field", () => {
    expect(names("kind:grain harvested:>@2024-06-01")).toEqual([
      "barley",
      "sweet corn",
    ]);
  });

  it("ranges over a date field", () => {
    expect(names("kind:herb harvested:[@2024-01-01 TO @2024-06-30]")).toEqual([
      "basil",
      "mint",
      "parsley",
      "thyme",
    ]);
  });

  it("matches a date-only literal on the calendar day", () => {
    expect(names("harvested:@2024-06-14")).toEqual(["barley"]);
    expect(names("harvested:@2024-06-15")).toEqual([]);
  });
});

describe("value-level operators", () => {
  it("accepts any operand of a value OR", () => {
    expect(names("kind:legume colors:(green OR red)")).toEqual([
      "edamame",
      "green bean",
      "pea",
      "red lentil",
    ]);
  });

  it("requires every operand of a value AND", () => {
    expect(names("colors:(red AND green)")).toEqual([
      "apple",
      "mango",
      "watermelon",
    ]);
  });

  it("negates inside a value group", () => {
    expect(names("kind:herb colors:(-green)")).toEqual(["saffron"]);
  });

  it("combines juxtaposed value expressions with AND", () => {
    expect(names("kind:fruit tags:(berry seasonal)")).toEqual([
      "blueberry",
      "cranberry",
      "raspberry",
      "strawberry",
    ]);
  });
});
