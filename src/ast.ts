/**
 * AST node types and builders for the fielded search language.
 *
 * Two expression families, distinguished by what they can combine:
 *
 *   - query level: filters, terms, groups        -> `QueryExpr`
 *   - value level: terms, comparisons, ranges    -> `ValueExpr`
 *
 * They are separate types rather than one generic family because negating a
 * record (`-service:foo`) is not the same operation as negating a field value
 * (`service:(-foo)`). `TermNode` is shared because it is structurally
 * identical at both levels: duplicate where the structure differs, share
 * where it is identical.
 *
 * A *primary* is self-delimiting — a literal, or a parenthesized expression.
 * A filter's value slot holds exactly one primary, which is what makes
 * `service:-foo` unrepresentable: `-` is an operator, and operators only
 * exist inside expressions. `ValueExpr` never mentions `FilterNode`, so
 * nested `key:value` is unrepresentable too.
 *
 * Round-tripping is a hard requirement: nodes keep enough of the original
 * lexeme (`raw`, `quoted`, and a `GroupNode` for every paren pair) that
 * `format(parse(s))` reproduces `s`.
 */

/* ------------------------------------------------------------------ */
/* Scalars — data, never operands                                      */
/* ------------------------------------------------------------------ */

export interface StringNode {
  type: "String";
  /** Unescaped value. Any `SPECIAL_CHARACTERS` here are literal. */
  value: string;
  /** `true` for `"quoted values"`, preserved on format. */
  quoted: boolean;
}

export interface WildcardNode {
  type: "Wildcard";
  /**
   * Pattern with unescaped `*` intact. Backslash escapes are preserved so a
   * literal `\*` stays distinguishable from a wildcard `*`.
   */
  pattern: string;
  quoted: boolean;
}

export interface NumberNode {
  type: "Number";
  value: number;
  /** Original lexeme, so `1` and `1.0` survive a round trip. */
  raw: string;
}

export interface DateTimeNode {
  type: "DateTime";
  /** Normalized instant, milliseconds since epoch. */
  value: number;
  /** Original lexeme, without the `@` marker. */
  raw: string;
}

export type ScalarNode = StringNode | WildcardNode | NumberNode | DateTimeNode;

/** Only these can be compared or bounded. */
export type NumericNode = NumberNode | DateTimeNode;

/* ------------------------------------------------------------------ */
/* Shared leaf                                                         */
/* ------------------------------------------------------------------ */

/**
 * A value with no field qualifier. The enclosing `FilterNode` scopes it, or
 * nothing does — what that means against real data is the application's call.
 */
export interface TermNode {
  type: "Term";
  value: ScalarNode;
}

/* ------------------------------------------------------------------ */
/* Value level                                                         */
/* ------------------------------------------------------------------ */

export type ComparisonOperator = ">" | ">=" | "<" | "<=";

export interface ComparisonNode {
  type: "Comparison";
  operator: ComparisonOperator;
  operand: NumericNode;
}

export interface RangeNode {
  type: "Range";
  from: NumericNode;
  to: NumericNode;
}

/** A paren pair inside a filter value. Children combine by juxtaposition. */
export interface ValueGroupNode {
  type: "ValueGroup";
  children: ValueExpr[];
}

export interface ValueNotNode {
  type: "ValueNot";
  operand: ValuePrimary;
}

export interface ValueAndNode {
  type: "ValueAnd";
  children: ValueExpr[];
}

export interface ValueOrNode {
  type: "ValueOr";
  children: ValueExpr[];
}

/** Self-delimiting: can stand alone as a filter's value. */
export type ValuePrimary =
  TermNode | ComparisonNode | RangeNode | ValueGroupNode;

export type ValueExpr =
  ValuePrimary | ValueNotNode | ValueAndNode | ValueOrNode;

/* ------------------------------------------------------------------ */
/* Query level                                                         */
/* ------------------------------------------------------------------ */

export interface FilterNode {
  type: "Filter";
  field: string;
  value: ValuePrimary;
}

/** A paren pair. Children combine by juxtaposition, same as the root. */
export interface GroupNode {
  type: "Group";
  children: QueryExpr[];
}

export interface NotNode {
  type: "Not";
  operand: QueryPrimary;
}

export interface AndNode {
  type: "And";
  children: QueryExpr[];
}

export interface OrNode {
  type: "Or";
  children: QueryExpr[];
}

/** Self-delimiting: what `-` can attach to. */
export type QueryPrimary = FilterNode | TermNode | GroupNode;

export type QueryExpr = QueryPrimary | NotNode | AndNode | OrNode;

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

/**
 * The parsed query. Children are combined by juxtaposition; the syntax does
 * not commit to AND or OR, leaving that to the evaluator.
 */
export interface QueryNode {
  type: "Query";
  children: QueryExpr[];
}

/** Any node in the tree, at any level. */
export type AnyNode = QueryNode | QueryExpr | ValueExpr | ScalarNode;

/* ------------------------------------------------------------------ */
/* Lexical constants                                                   */
/* ------------------------------------------------------------------ */

/**
 * Characters carrying syntactic meaning, which a backslash escape turns into
 * literal string content.
 *
 * `:` `(` `)` `[` `]` `"` `*` `\` `>` `<` are special wherever they appear
 * unquoted. `@` and `-` are special only at the start of a scalar — `a@b` and
 * `a-b` need no escaping, `@home` and `-foo` do.
 *
 * Inside quotes only `"` and `\` strictly require escaping, but `format`
 * escapes `*` regardless so an exact value never re-parses as a wildcard.
 */
export const SPECIAL_CHARACTERS = [
  ":",
  "(",
  ")",
  "[",
  "]",
  '"',
  "*",
  "\\",
  ">",
  "<",
  "@",
  "-",
] as const;

/** Marks an explicit datetime literal: `@2024-01-15`. */
export const DATETIME_PREFIX = "@";

/* ------------------------------------------------------------------ */
/* Scalar builders                                                     */
/* ------------------------------------------------------------------ */

/**
 * Exact string match. Any `SPECIAL_CHARACTERS` in `value` are literal content
 * and get escaped on format — notably `*`, so an exact value never
 * degrades into a wildcard.
 */
export function exact(value: string, quoted = false): StringNode {
  return { type: "String", value, quoted };
}

/** Wildcard pattern match. Unescaped `*` are significant. */
export function wildcard(pattern: string, quoted = false): WildcardNode {
  return { type: "Wildcard", pattern, quoted };
}

/**
 * Numeric literal. `raw` preserves the source lexeme and defaults to
 * `String(value)`, which is right for hand-built ASTs. Formatting fidelity
 * such as `1.0` only survives when `raw` is supplied — the parser always
 * supplies it, but `number(1.0)` cannot, since JS collapses that literal to
 * `1` before the call.
 */
export function number(value: number, raw?: string): NumberNode {
  return { type: "Number", value, raw: raw ?? String(value) };
}

/** DateTime literal as epoch milliseconds; `raw` is the lexeme sans `@`. */
export function dateTime(value: number, raw: string): DateTimeNode {
  return { type: "DateTime", value, raw };
}

/* ------------------------------------------------------------------ */
/* Shared builder                                                      */
/* ------------------------------------------------------------------ */

/** A value with no field qualifier. */
export function term(value: ScalarNode): TermNode {
  return { type: "Term", value };
}

/* ------------------------------------------------------------------ */
/* Value-level builders                                                */
/* ------------------------------------------------------------------ */

/** Comparison against a scalar: `>2`, `<=10.4`, `>@2024-01-15`. */
export function comparison(
  operator: ComparisonOperator,
  operand: NumericNode,
): ComparisonNode {
  return { type: "Comparison", operator, operand };
}

/** Bounded range: `[2 TO 10]`. */
export function range(from: NumericNode, to: NumericNode): RangeNode {
  return { type: "Range", from, to };
}

/** Parenthesized value expression. */
export function valueGroup(children: ValueExpr[]): ValueGroupNode {
  return { type: "ValueGroup", children };
}

/** Value negation, written `-value` inside a value group. */
export function valueNot(operand: ValuePrimary): ValueNotNode {
  return { type: "ValueNot", operand };
}

export function valueAnd(children: ValueExpr[]): ValueAndNode {
  return { type: "ValueAnd", children };
}

export function valueOr(children: ValueExpr[]): ValueOrNode {
  return { type: "ValueOr", children };
}

/* ------------------------------------------------------------------ */
/* Query-level builders                                                */
/* ------------------------------------------------------------------ */

/** Field filter: `field:value`. */
export function filter(field: string, value: ValuePrimary): FilterNode {
  return { type: "Filter", field, value };
}

/** Parenthesized query expression. */
export function group(children: QueryExpr[]): GroupNode {
  return { type: "Group", children };
}

/** Record negation, written `-primary`. */
export function not(operand: QueryPrimary): NotNode {
  return { type: "Not", operand };
}

export function and(children: QueryExpr[]): AndNode {
  return { type: "And", children };
}

export function or(children: QueryExpr[]): OrNode {
  return { type: "Or", children };
}

/** The root. Children combine by juxtaposition. */
export function query(children: QueryExpr[]): QueryNode {
  return { type: "Query", children };
}
