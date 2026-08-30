import { describe, expect, it } from "vitest";
import { parse } from "./parser";
import { stringify } from "./stringify";
import * as ast from "./ast";

/** Shorthand: a root wrapping one expression. */
const q = (child: ast.QueryExpr) => ast.query([child]);

/* ------------------------------------------------------------------ */
/* scalars                                                             */
/* ------------------------------------------------------------------ */

describe("scalars", () => {
  it("renders a bare string", () => {
    expect(stringify(q(ast.term(ast.exact("apple"))))).toBe("apple");
  });

  it("renders a quoted string", () => {
    expect(stringify(q(ast.term(ast.exact("apple", true))))).toBe('"apple"');
  });

  it("renders a number from its raw lexeme", () => {
    expect(stringify(q(ast.term(ast.number(1, "1.0"))))).toBe("1.0");
    expect(stringify(q(ast.term(ast.number(1, "1"))))).toBe("1");
  });

  it("renders a negative number", () => {
    expect(stringify(q(ast.term(ast.number(-5, "-5"))))).toBe("-5");
  });

  it("renders a datetime with its marker", () => {
    expect(
      stringify(
        q(ast.term(ast.dateTime(Date.parse("2024-01-15"), "2024-01-15"))),
      ),
    ).toBe("@2024-01-15");
  });

  it("renders a wildcard pattern verbatim", () => {
    expect(stringify(q(ast.term(ast.wildcard("*err*"))))).toBe("*err*");
  });

  it("renders a quoted wildcard", () => {
    expect(stringify(q(ast.term(ast.wildcard("dragon *", true))))).toBe(
      '"dragon *"',
    );
  });
});

/* ------------------------------------------------------------------ */
/* escaping — the reason exact() exists                                */
/* ------------------------------------------------------------------ */

describe("escaping", () => {
  const bare = (value: string) => stringify(q(ast.term(ast.exact(value))));
  const quoted = (value: string) =>
    stringify(q(ast.term(ast.exact(value, true))));

  it("escapes a star so an exact value never becomes a wildcard", () => {
    expect(bare("app*le")).toBe("app\\*le");
  });

  it("escapes a star inside quotes too", () => {
    expect(quoted("app*le")).toBe('"app\\*le"');
  });

  it("escapes whitespace in a bare value", () => {
    expect(bare("banana bread")).toBe("banana\\ bread");
  });

  it("escapes structural characters in a bare value", () => {
    expect(bare("a:b")).toBe("a\\:b");
    expect(bare("a(b)")).toBe("a\\(b\\)");
    expect(bare("a[b]")).toBe("a\\[b\\]");
    expect(bare("a>b")).toBe("a\\>b");
  });

  it("escapes a backslash", () => {
    expect(bare("a\\b")).toBe("a\\\\b");
    expect(quoted("a\\b")).toBe('"a\\\\b"');
  });

  it("escapes a quote inside quotes", () => {
    expect(quoted('say "hello"')).toBe('"say \\"hello\\""');
  });

  it("escapes a leading hyphen so it is not read as an operator", () => {
    expect(bare("-foo")).toBe("\\-foo");
  });

  it("escapes a leading at-sign so it is not read as a datetime", () => {
    expect(bare("@home")).toBe("\\@home");
  });

  it("leaves a hyphen or at-sign alone mid-value", () => {
    expect(bare("granny-smith")).toBe("granny-smith");
    expect(bare("a@b")).toBe("a@b");
  });

  it("masks a value that would re-read as a keyword", () => {
    expect(bare("AND")).toBe("\\AND");
    expect(bare("OR")).toBe("\\OR");
    expect(bare("TO")).toBe("\\TO");
  });

  it("masks a value that would re-read as a number", () => {
    expect(bare("5")).toBe("\\5");
    expect(bare("-5")).toBe("\\-5");
    expect(bare("1.0")).toBe("\\1.0");
  });

  it("quotes an empty value, which cannot be written bare", () => {
    expect(bare("")).toBe('""');
    expect(quoted("")).toBe('""');
  });

  it("escapes structural characters in a field name", () => {
    expect(stringify(q(ast.filter("a b", ast.term(ast.exact("x")))))).toBe(
      "a\\ b:x",
    );
  });

  it("masks a keyword field name", () => {
    expect(stringify(q(ast.filter("AND", ast.term(ast.exact("x")))))).toBe(
      "\\AND:x",
    );
  });

  it("leaves a numeric field name bare", () => {
    expect(stringify(q(ast.filter("5", ast.term(ast.exact("x")))))).toBe("5:x");
  });
});

/* ------------------------------------------------------------------ */
/* structure                                                           */
/* ------------------------------------------------------------------ */

describe("structure", () => {
  const apple = ast.filter("fruit", ast.term(ast.exact("apple")));
  const red = ast.filter("color", ast.term(ast.exact("red")));

  it("joins root children with a space", () => {
    expect(stringify(ast.query([apple, red]))).toBe("fruit:apple color:red");
  });

  it("renders AND", () => {
    expect(stringify(q(ast.and([apple, red])))).toBe(
      "fruit:apple AND color:red",
    );
  });

  it("renders OR", () => {
    expect(stringify(q(ast.or([apple, red])))).toBe("fruit:apple OR color:red");
  });

  it("renders negation", () => {
    expect(stringify(q(ast.not(apple)))).toBe("-fruit:apple");
  });

  it("delimits a negated operand that starts with a digit", () => {
    // `-5` would lex back as a negative number, not a negation.
    expect(stringify(q(ast.not(ast.term(ast.number(5)))))).toBe("-(5)");
    expect(
      stringify(q(ast.not(ast.filter("5", ast.term(ast.exact("x")))))),
    ).toBe("-(5:x)");
    expect(stringify(q(ast.not(ast.term(ast.exact("5abc")))))).toBe("-(5abc)");
  });

  it("delimits a negated value that starts with a digit", () => {
    expect(
      stringify(
        q(
          ast.filter(
            "k",
            ast.valueGroup([ast.valueNot(ast.term(ast.number(5)))]),
          ),
        ),
      ),
    ).toBe("k:(-(5))");
  });

  it("keeps a negated non-digit operand undelimited", () => {
    expect(stringify(q(ast.not(ast.term(ast.exact("apple")))))).toBe("-apple");
    expect(stringify(q(ast.not(ast.term(ast.number(-5)))))).toBe("--5");
  });

  it("renders a group", () => {
    expect(stringify(q(ast.group([apple, red])))).toBe(
      "(fruit:apple color:red)",
    );
  });

  it("renders a comparison", () => {
    expect(
      stringify(q(ast.filter("seeds", ast.comparison(">=", ast.number(2))))),
    ).toBe("seeds:>=2");
  });

  it("renders a range", () => {
    expect(
      stringify(
        q(ast.filter("seeds", ast.range(ast.number(2), ast.number(10)))),
      ),
    ).toBe("seeds:[2 TO 10]");
  });

  it("renders a datetime range", () => {
    const from = ast.dateTime(Date.parse("2024-01-01"), "2024-01-01");
    const to = ast.dateTime(Date.parse("2024-12-31"), "2024-12-31");
    expect(stringify(q(ast.filter("harvested", ast.range(from, to))))).toBe(
      "harvested:[@2024-01-01 TO @2024-12-31]",
    );
  });

  it("renders a value group", () => {
    expect(
      stringify(
        q(
          ast.filter(
            "fruit",
            ast.valueGroup([
              ast.valueOr([
                ast.term(ast.exact("apple")),
                ast.term(ast.exact("pear")),
              ]),
            ]),
          ),
        ),
      ),
    ).toBe("fruit:(apple OR pear)");
  });

  it("renders a negated value", () => {
    expect(
      stringify(
        q(
          ast.filter(
            "fruit",
            ast.valueGroup([ast.valueNot(ast.term(ast.exact("apple")))]),
          ),
        ),
      ),
    ).toBe("fruit:(-apple)");
  });

  it("renders juxtaposed value-group children with a space", () => {
    expect(
      stringify(
        q(
          ast.filter(
            "fruit",
            ast.valueGroup([
              ast.term(ast.exact("apple")),
              ast.term(ast.exact("pear")),
            ]),
          ),
        ),
      ),
    ).toBe("fruit:(apple pear)");
  });
});

/* ------------------------------------------------------------------ */
/* precedence — synthesized parens for hand-built trees                */
/* ------------------------------------------------------------------ */

describe("precedence", () => {
  const a = ast.term(ast.exact("a"));
  const b = ast.term(ast.exact("b"));
  const c = ast.term(ast.exact("c"));

  it("parenthesizes an OR nested directly inside an AND", () => {
    expect(stringify(q(ast.and([ast.or([a, b]), c])))).toBe("(a OR b) AND c");
  });

  it("parenthesizes an OR on the right of an AND", () => {
    expect(stringify(q(ast.and([a, ast.or([b, c])])))).toBe("a AND (b OR c)");
  });

  it("leaves an AND inside an OR unparenthesized", () => {
    expect(stringify(q(ast.or([ast.and([a, b]), c])))).toBe("a AND b OR c");
  });

  it("leaves operators unparenthesized as root children", () => {
    expect(stringify(ast.query([a, ast.or([b, c])]))).toBe("a b OR c");
  });

  it("applies the same rule at the value level", () => {
    const va = ast.term(ast.exact("a"));
    const vb = ast.term(ast.exact("b"));
    const vc = ast.term(ast.exact("c"));
    expect(
      stringify(
        q(
          ast.filter(
            "k",
            ast.valueGroup([ast.valueAnd([ast.valueOr([va, vb]), vc])]),
          ),
        ),
      ),
    ).toBe("k:((a OR b) AND c)");
  });

  it("re-parses a synthesized-paren tree to the same meaning", () => {
    const built = q(ast.and([ast.or([a, b]), c]));
    const text = stringify(built);
    // The reparse gains an explicit GroupNode, so compare rendered forms.
    expect(stringify(parse(text))).toBe(text);
  });
});

/* ------------------------------------------------------------------ */
/* round trip                                                          */
/* ------------------------------------------------------------------ */

const CORPUS = [
  "fruit:apple",
  'fruit:"apple"',
  "fruit:apple color:red",
  "fruit:apple AND color:red",
  "fruit:apple OR color:red",
  "a AND b OR c",
  "a OR b AND c",
  "a b AND c",
  "a b c",
  "-fruit:apple",
  "-apple",
  "fruit:apple -color:red",
  "-(fruit:apple AND color:red)",
  "-(-apple)",
  "(a b)",
  "(a OR b) AND c",
  "((a))",
  "fruit:(apple OR banana)",
  "fruit:(apple banana)",
  "fruit:(apple AND -banana)",
  "fruit:(-apple)",
  "fruit:((apple OR pear) AND red)",
  "count:>2",
  "count:>=2",
  "count:<10.4",
  "count:<=10.4",
  "count:[2 TO 10]",
  "weight:[1.50 TO 3.5]",
  "weight:1.0",
  "weight:1",
  "temp:-5",
  "temp:-2.5",
  "temp:>-5",
  "temp:[-10 TO -5]",
  "harvested:@2024-01-15",
  "harvested:>@2024-01-15",
  "harvested:[@2024-01-01 TO @2024-12-31]",
  "harvested:@2024-01-15T10:30:00Z",
  "@2024-01-15",
  "fruit:*erry",
  "fruit:apple*",
  "fruit:*pp*le*",
  'fruit:"dragon *"',
  "note:apple\\:pie",
  "note:banana\\ bread",
  "label:2\\*4",
  "note:\\@home",
  "note:granny-smith",
  "note:a@b",
  "\\-apple",
  'note:"say \\"hello\\""',
  'note:"C:\\\\"',
  "culinary-fruit:granny_smith",
  "kind:(fruit OR vegetable) seeds:[1 TO 40] -color:green",
];

describe("round trip", () => {
  it.each(CORPUS)("stringify(parse(%j)) is identity", (source) => {
    expect(stringify(parse(source))).toBe(source);
  });

  it.each(CORPUS)("parse is stable across a render cycle (%j)", (source) => {
    const once = parse(source);
    expect(parse(stringify(once))).toEqual(once);
  });
});
