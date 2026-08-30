import { describe, expect, it } from "vitest";
import { parse } from "./parser";
import * as ast from "./ast";

/* ------------------------------------------------------------------ */
/* basic field search                                                  */
/* ------------------------------------------------------------------ */

describe("basic field search", () => {
  it("parses a simple field:value pair", () => {
    expect(parse("fruit:apple")).toEqual(
      ast.query([ast.filter("fruit", ast.term(ast.exact("apple")))]),
    );
  });

  it("parses a quoted value", () => {
    expect(parse('fruit:"apple"')).toEqual(
      ast.query([ast.filter("fruit", ast.term(ast.exact("apple", true)))]),
    );
  });

  it("preserves hyphens and underscores in field names", () => {
    expect(parse("culinary-fruit:granny_smith")).toEqual(
      ast.query([
        ast.filter("culinary-fruit", ast.term(ast.exact("granny_smith"))),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* bare terms                                                          */
/* ------------------------------------------------------------------ */

describe("bare terms", () => {
  it("parses a bare word", () => {
    expect(parse("apple")).toEqual(ast.query([ast.term(ast.exact("apple"))]));
  });

  it("parses a bare quoted string", () => {
    expect(parse('"banana bread"')).toEqual(
      ast.query([ast.term(ast.exact("banana bread", true))]),
    );
  });

  it("parses a bare number", () => {
    expect(parse("42")).toEqual(ast.query([ast.term(ast.number(42, "42"))]));
  });

  it("parses a bare wildcard", () => {
    expect(parse("berr*")).toEqual(
      ast.query([ast.term(ast.wildcard("berr*"))]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* juxtaposition — the root carries no operator                        */
/* ------------------------------------------------------------------ */

describe("juxtaposition", () => {
  it("collects two filters as sibling children", () => {
    expect(parse("fruit:apple color:red")).toEqual(
      ast.query([
        ast.filter("fruit", ast.term(ast.exact("apple"))),
        ast.filter("color", ast.term(ast.exact("red"))),
      ]),
    );
  });

  it("mixes a filter and a bare term", () => {
    expect(parse("fruit:apple banana")).toEqual(
      ast.query([
        ast.filter("fruit", ast.term(ast.exact("apple"))),
        ast.term(ast.exact("banana")),
      ]),
    );
  });

  it("collects three children", () => {
    expect(parse("a b c")).toEqual(
      ast.query([
        ast.term(ast.exact("a")),
        ast.term(ast.exact("b")),
        ast.term(ast.exact("c")),
      ]),
    );
  });

  it("works inside a group", () => {
    expect(parse("(a b)")).toEqual(
      ast.query([
        ast.group([ast.term(ast.exact("a")), ast.term(ast.exact("b"))]),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* boolean operators and precedence                                    */
/* ------------------------------------------------------------------ */

describe("boolean operators", () => {
  it("parses AND", () => {
    expect(parse("fruit:apple AND color:red")).toEqual(
      ast.query([
        ast.and([
          ast.filter("fruit", ast.term(ast.exact("apple"))),
          ast.filter("color", ast.term(ast.exact("red"))),
        ]),
      ]),
    );
  });

  it("parses OR", () => {
    expect(parse("fruit:apple OR fruit:banana")).toEqual(
      ast.query([
        ast.or([
          ast.filter("fruit", ast.term(ast.exact("apple"))),
          ast.filter("fruit", ast.term(ast.exact("banana"))),
        ]),
      ]),
    );
  });

  it("flattens a run of ANDs", () => {
    expect(parse("a AND b AND c")).toEqual(
      ast.query([
        ast.and([
          ast.term(ast.exact("a")),
          ast.term(ast.exact("b")),
          ast.term(ast.exact("c")),
        ]),
      ]),
    );
  });

  it("flattens a run of ORs", () => {
    expect(parse("a OR b OR c")).toEqual(
      ast.query([
        ast.or([
          ast.term(ast.exact("a")),
          ast.term(ast.exact("b")),
          ast.term(ast.exact("c")),
        ]),
      ]),
    );
  });

  it("binds AND tighter than OR", () => {
    expect(parse("a AND b OR c")).toEqual(
      ast.query([
        ast.or([
          ast.and([ast.term(ast.exact("a")), ast.term(ast.exact("b"))]),
          ast.term(ast.exact("c")),
        ]),
      ]),
    );
  });

  it("binds AND tighter than OR on the right too", () => {
    expect(parse("a OR b AND c")).toEqual(
      ast.query([
        ast.or([
          ast.term(ast.exact("a")),
          ast.and([ast.term(ast.exact("b")), ast.term(ast.exact("c"))]),
        ]),
      ]),
    );
  });

  it("binds juxtaposition looser than AND", () => {
    expect(parse("a b AND c")).toEqual(
      ast.query([
        ast.term(ast.exact("a")),
        ast.and([ast.term(ast.exact("b")), ast.term(ast.exact("c"))]),
      ]),
    );
  });

  it("lets a group override precedence", () => {
    expect(parse("(a OR b) AND c")).toEqual(
      ast.query([
        ast.and([
          ast.group([
            ast.or([ast.term(ast.exact("a")), ast.term(ast.exact("b"))]),
          ]),
          ast.term(ast.exact("c")),
        ]),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* negation                                                            */
/* ------------------------------------------------------------------ */

describe("negation", () => {
  it("negates a filter", () => {
    expect(parse("-fruit:apple")).toEqual(
      ast.query([ast.not(ast.filter("fruit", ast.term(ast.exact("apple"))))]),
    );
  });

  it("negates a bare term", () => {
    expect(parse("-apple")).toEqual(
      ast.query([ast.not(ast.term(ast.exact("apple")))]),
    );
  });

  it("negates a group", () => {
    expect(parse("-(fruit:apple AND color:red)")).toEqual(
      ast.query([
        ast.not(
          ast.group([
            ast.and([
              ast.filter("fruit", ast.term(ast.exact("apple"))),
              ast.filter("color", ast.term(ast.exact("red"))),
            ]),
          ]),
        ),
      ]),
    );
  });

  it("binds tighter than AND", () => {
    expect(parse("-a AND b")).toEqual(
      ast.query([
        ast.and([ast.not(ast.term(ast.exact("a"))), ast.term(ast.exact("b"))]),
      ]),
    );
  });

  it("juxtaposes a filter with a negated filter", () => {
    expect(parse("fruit:apple -color:red")).toEqual(
      ast.query([
        ast.filter("fruit", ast.term(ast.exact("apple"))),
        ast.not(ast.filter("color", ast.term(ast.exact("red")))),
      ]),
    );
  });

  it("negates a value inside a value group", () => {
    expect(parse("fruit:(apple AND -banana)")).toEqual(
      ast.query([
        ast.filter(
          "fruit",
          ast.valueGroup([
            ast.valueAnd([
              ast.term(ast.exact("apple")),
              ast.valueNot(ast.term(ast.exact("banana"))),
            ]),
          ]),
        ),
      ]),
    );
  });

  it("reaches a negated value through an explicit group", () => {
    expect(parse("fruit:(-apple)")).toEqual(
      ast.query([
        ast.filter(
          "fruit",
          ast.valueGroup([ast.valueNot(ast.term(ast.exact("apple")))]),
        ),
      ]),
    );
  });

  it("rejects an operator in the value slot", () => {
    expect(() => parse("service:-foo")).toThrow(/operator|negate/i);
  });

  it("rejects double negation", () => {
    expect(() => parse("--apple")).toThrow(/double negation/i);
    expect(() => parse("fruit:(--apple)")).toThrow(/double negation/i);
  });

  it("allows double negation through a group", () => {
    expect(parse("-(-apple)")).toEqual(
      ast.query([ast.not(ast.group([ast.not(ast.term(ast.exact("apple")))]))]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* value groups                                                        */
/* ------------------------------------------------------------------ */

describe("value groups", () => {
  it("parses OR inside a value group", () => {
    expect(parse('fruit:("apple" OR "banana")')).toEqual(
      ast.query([
        ast.filter(
          "fruit",
          ast.valueGroup([
            ast.valueOr([
              ast.term(ast.exact("apple", true)),
              ast.term(ast.exact("banana", true)),
            ]),
          ]),
        ),
      ]),
    );
  });

  it("parses juxtaposition inside a value group", () => {
    expect(parse("fruit:(apple banana)")).toEqual(
      ast.query([
        ast.filter(
          "fruit",
          ast.valueGroup([
            ast.term(ast.exact("apple")),
            ast.term(ast.exact("banana")),
          ]),
        ),
      ]),
    );
  });

  it("parses comparisons inside a value group", () => {
    expect(parse("count:(>2 AND <10)")).toEqual(
      ast.query([
        ast.filter(
          "count",
          ast.valueGroup([
            ast.valueAnd([
              ast.comparison(">", ast.number(2)),
              ast.comparison("<", ast.number(10)),
            ]),
          ]),
        ),
      ]),
    );
  });

  it("materializes a group around a single value", () => {
    expect(parse("fruit:(apple)")).toEqual(
      ast.query([
        ast.filter("fruit", ast.valueGroup([ast.term(ast.exact("apple"))])),
      ]),
    );
  });

  it("nests value groups", () => {
    expect(parse("fruit:((apple OR pear) AND red)")).toEqual(
      ast.query([
        ast.filter(
          "fruit",
          ast.valueGroup([
            ast.valueAnd([
              ast.valueGroup([
                ast.valueOr([
                  ast.term(ast.exact("apple")),
                  ast.term(ast.exact("pear")),
                ]),
              ]),
              ast.term(ast.exact("red")),
            ]),
          ]),
        ),
      ]),
    );
  });

  it("rejects a field filter inside a value", () => {
    expect(() => parse("fruit:(color:red)")).toThrow(/field filter/i);
  });
});

/* ------------------------------------------------------------------ */
/* numerical operators                                                 */
/* ------------------------------------------------------------------ */

describe("numerical operators", () => {
  it("parses >", () => {
    expect(parse("seeds:>5")).toEqual(
      ast.query([ast.filter("seeds", ast.comparison(">", ast.number(5, "5")))]),
    );
  });

  it("parses >=", () => {
    expect(parse("seeds:>=2")).toEqual(
      ast.query([
        ast.filter("seeds", ast.comparison(">=", ast.number(2, "2"))),
      ]),
    );
  });

  it("parses < with a float", () => {
    expect(parse("weight:<10.4")).toEqual(
      ast.query([
        ast.filter("weight", ast.comparison("<", ast.number(10.4, "10.4"))),
      ]),
    );
  });

  it("parses <=", () => {
    expect(parse("weight:<=10.4")).toEqual(
      ast.query([
        ast.filter("weight", ast.comparison("<=", ast.number(10.4, "10.4"))),
      ]),
    );
  });

  it("parses a plain integer", () => {
    expect(parse("seeds:2")).toEqual(
      ast.query([ast.filter("seeds", ast.term(ast.number(2, "2")))]),
    );
  });

  it("parses a range", () => {
    expect(parse("seeds:[2 TO 10]")).toEqual(
      ast.query([
        ast.filter(
          "seeds",
          ast.range(ast.number(2, "2"), ast.number(10, "10")),
        ),
      ]),
    );
  });

  it("parses a float range", () => {
    expect(parse("weight:[1.5 TO 3.5]")).toEqual(
      ast.query([
        ast.filter(
          "weight",
          ast.range(ast.number(1.5, "1.5"), ast.number(3.5, "3.5")),
        ),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* negative numbers                                                    */
/* ------------------------------------------------------------------ */

describe("negative numbers", () => {
  it("parses a negative value", () => {
    expect(parse("temp:-5")).toEqual(
      ast.query([ast.filter("temp", ast.term(ast.number(-5, "-5")))]),
    );
  });

  it("parses a negative float", () => {
    expect(parse("temp:-2.5")).toEqual(
      ast.query([ast.filter("temp", ast.term(ast.number(-2.5, "-2.5")))]),
    );
  });

  it("parses a negative comparison operand", () => {
    expect(parse("temp:>-5")).toEqual(
      ast.query([
        ast.filter("temp", ast.comparison(">", ast.number(-5, "-5"))),
      ]),
    );
  });

  it("parses a negative range", () => {
    expect(parse("temp:[-10 TO -5]")).toEqual(
      ast.query([
        ast.filter(
          "temp",
          ast.range(ast.number(-10, "-10"), ast.number(-5, "-5")),
        ),
      ]),
    );
  });

  it("parses a bare negative number as a term, not a negation", () => {
    expect(parse("-5")).toEqual(ast.query([ast.term(ast.number(-5, "-5"))]));
  });

  it("treats a hyphen before a non-digit as negation", () => {
    expect(parse("-apple")).toEqual(
      ast.query([ast.not(ast.term(ast.exact("apple")))]),
    );
  });

  it("keeps a hyphen inside a word", () => {
    expect(parse("note:granny-smith")).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("granny-smith")))]),
    );
  });

  it("treats an escaped leading hyphen as literal text", () => {
    expect(parse("\\-apple")).toEqual(
      ast.query([ast.term(ast.exact("-apple"))]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* datetimes                                                           */
/* ------------------------------------------------------------------ */

describe("datetimes", () => {
  const day = Date.parse("2024-01-15");

  it("parses a date literal", () => {
    expect(parse("harvested:@2024-01-15")).toEqual(
      ast.query([
        ast.filter("harvested", ast.term(ast.dateTime(day, "2024-01-15"))),
      ]),
    );
  });

  it("parses a full timestamp with colons", () => {
    const stamp = "2024-01-15T10:30:00Z";
    expect(parse(`harvested:@${stamp}`)).toEqual(
      ast.query([
        ast.filter(
          "harvested",
          ast.term(ast.dateTime(Date.parse(stamp), stamp)),
        ),
      ]),
    );
  });

  it("parses a timestamp with a UTC offset", () => {
    const stamp = "2024-01-15T10:30:00-05:00";
    expect(parse(`harvested:@${stamp}`)).toEqual(
      ast.query([
        ast.filter(
          "harvested",
          ast.term(ast.dateTime(Date.parse(stamp), stamp)),
        ),
      ]),
    );
  });

  it("parses a datetime comparison", () => {
    expect(parse("harvested:>@2024-01-15")).toEqual(
      ast.query([
        ast.filter(
          "harvested",
          ast.comparison(">", ast.dateTime(day, "2024-01-15")),
        ),
      ]),
    );
  });

  it("parses a datetime range", () => {
    const from = "2024-01-01";
    const to = "2024-12-31";
    expect(parse(`harvested:[@${from} TO @${to}]`)).toEqual(
      ast.query([
        ast.filter(
          "harvested",
          ast.range(
            ast.dateTime(Date.parse(from), from),
            ast.dateTime(Date.parse(to), to),
          ),
        ),
      ]),
    );
  });

  it("parses a bare datetime term", () => {
    expect(parse("@2024-01-15")).toEqual(
      ast.query([ast.term(ast.dateTime(day, "2024-01-15"))]),
    );
  });

  it("treats an escaped at-sign as literal text", () => {
    expect(parse("note:\\@home")).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("@home")))]),
    );
  });

  it("keeps an at-sign inside a word", () => {
    expect(parse("note:a@b")).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("a@b")))]),
    );
  });

  it("rejects a non-datetime after @", () => {
    expect(() => parse("harvested:@home")).toThrow(/datetime/i);
  });

  it("rejects a bare year after @", () => {
    expect(() => parse("harvested:@2024")).toThrow(/datetime/i);
  });

  it("rejects mixed range bounds", () => {
    expect(() => parse("harvested:[@2024-01-01 TO 5]")).toThrow(/same kind/i);
  });
});

/* ------------------------------------------------------------------ */
/* number formatting preservation                                      */
/* ------------------------------------------------------------------ */

describe("number formatting preservation", () => {
  it("distinguishes 1 from 1.0 by raw only", () => {
    const int = parse("weight:1").children[0] as ast.FilterNode;
    const float = parse("weight:1.0").children[0] as ast.FilterNode;
    const a = (int.value as ast.TermNode).value as ast.NumberNode;
    const b = (float.value as ast.TermNode).value as ast.NumberNode;

    expect(a.value).toBe(b.value);
    expect(a.raw).toBe("1");
    expect(b.raw).toBe("1.0");
  });

  it("keeps the lexeme inside a comparison", () => {
    expect(parse("weight:<10.40")).toEqual(
      ast.query([
        ast.filter("weight", ast.comparison("<", ast.number(10.4, "10.40"))),
      ]),
    );
  });

  it("keeps the lexeme inside a range", () => {
    expect(parse("weight:[1.50 TO 3.5]")).toEqual(
      ast.query([
        ast.filter(
          "weight",
          ast.range(ast.number(1.5, "1.50"), ast.number(3.5, "3.5")),
        ),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* wildcards                                                           */
/* ------------------------------------------------------------------ */

describe("wildcards", () => {
  it("parses a leading wildcard", () => {
    expect(parse("fruit:*erry")).toEqual(
      ast.query([ast.filter("fruit", ast.term(ast.wildcard("*erry")))]),
    );
  });

  it("parses a trailing wildcard", () => {
    expect(parse("fruit:apple*")).toEqual(
      ast.query([ast.filter("fruit", ast.term(ast.wildcard("apple*")))]),
    );
  });

  it("parses infix wildcards", () => {
    expect(parse("fruit:*pp*le*")).toEqual(
      ast.query([ast.filter("fruit", ast.term(ast.wildcard("*pp*le*")))]),
    );
  });

  it("parses a quoted wildcard", () => {
    expect(parse('fruit:"dragon *"')).toEqual(
      ast.query([
        ast.filter("fruit", ast.term(ast.wildcard("dragon *", true))),
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* escaping                                                            */
/* ------------------------------------------------------------------ */

describe("escaping", () => {
  it("allows spaces inside quoted strings", () => {
    expect(parse('fruit:"banana bread"')).toEqual(
      ast.query([
        ast.filter("fruit", ast.term(ast.exact("banana bread", true))),
      ]),
    );
  });

  it("unescapes a double-quote inside a quoted string", () => {
    expect(parse('note:"say \\"hello\\""')).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact('say "hello"', true)))]),
    );
  });

  it("unescapes a backslash inside a quoted string", () => {
    expect(parse('note:"C:\\\\"')).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("C:\\", true)))]),
    );
  });

  it("treats an escaped star as literal, not a wildcard", () => {
    expect(parse("label:2\\*4")).toEqual(
      ast.query([ast.filter("label", ast.term(ast.exact("2*4")))]),
    );
  });

  it("unescapes a colon inside an unquoted value", () => {
    expect(parse("note:apple\\:pie")).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("apple:pie")))]),
    );
  });

  it("unescapes a space inside an unquoted value", () => {
    expect(parse("note:banana\\ bread")).toEqual(
      ast.query([ast.filter("note", ast.term(ast.exact("banana bread")))]),
    );
  });

  it("escapes every documented special character", () => {
    for (const ch of ast.SPECIAL_CHARACTERS) {
      expect(
        parse(`note:a\\${ch}b`),
        `failed for ${JSON.stringify(ch)}`,
      ).toEqual(
        ast.query([ast.filter("note", ast.term(ast.exact(`a${ch}b`)))]),
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* error handling                                                      */
/* ------------------------------------------------------------------ */

describe("error handling", () => {
  it("throws on empty input", () => {
    expect(() => parse("")).toThrow(/empty/i);
    expect(() => parse("   ")).toThrow(/empty/i);
  });

  it("throws on an empty group", () => {
    expect(() => parse("()")).toThrow(/empty group/i);
    expect(() => parse("fruit:()")).toThrow(/empty group/i);
  });

  it("throws on an unclosed group", () => {
    expect(() => parse("(fruit:apple")).toThrow(/unclosed/i);
  });

  it("throws on an unexpected closing paren", () => {
    expect(() => parse("fruit:apple)")).toThrow(/unexpected/i);
  });

  it("throws on an unterminated quoted string", () => {
    expect(() => parse('fruit:"apple')).toThrow(/unterminated/i);
  });

  it("throws on a field with no value", () => {
    expect(() => parse("fruit:")).toThrow(/value/i);
  });

  it("throws on a dangling AND", () => {
    expect(() => parse("fruit:apple AND")).toThrow(/expected an operand/i);
  });

  it("throws on a dangling OR", () => {
    expect(() => parse("fruit:apple OR")).toThrow(/expected an operand/i);
  });

  it("throws on a dangling negation", () => {
    expect(() => parse("fruit:apple -")).toThrow(/expected an operand/i);
  });

  it("throws on an incomplete range", () => {
    expect(() => parse("seeds:[2 TO]")).toThrow(/range/i);
    expect(() => parse("seeds:[TO 10]")).toThrow(/range/i);
    expect(() => parse("seeds:[2 10]")).toThrow(/TO/);
    expect(() => parse("seeds:[2 TO 10")).toThrow(/unclosed/i);
  });

  it("throws on an incomplete comparison", () => {
    expect(() => parse("seeds:>")).toThrow(/expected a number/i);
  });

  it("throws on a non-numeric comparison operand", () => {
    expect(() => parse("seeds:>apple")).toThrow(/number/i);
  });

  it("throws on an unescaped stray special character", () => {
    expect(() => parse("note:apple(1)")).toThrow(/unescaped/i);
  });

  it("reports the offending position", () => {
    let message = "";
    try {
      parse("fruit:");
      expect.fail("expected parse to throw");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.toLowerCase()).toContain("value");
    expect(message).toMatch(/\d/);
  });
});
