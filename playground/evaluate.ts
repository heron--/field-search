import type {
  ComparisonNode,
  QueryExpr,
  QueryNode,
  RangeNode,
  ScalarNode,
  ValueExpr,
} from "../src/ast";
import type { Produce } from "./data";

/**
 * Example evaluator — deliberately NOT part of the library.
 *
 * `field-search` stops at string <-> AST. What a node *means* against real
 * records is dataset-specific, so evaluation lives here in the playground as
 * one worked example rather than a blessed answer.
 *
 * Every semantic choice below belongs to this example. Consumers
 * (devinmar.sh, danidevin.wedding) should expect to make their own against
 * their own data:
 *
 *   - `QueryNode`/`GroupNode` children are juxtaposed with no operator; this
 *     example combines them with AND, but OR is equally valid
 *   - `AndNode` needs every child, `OrNode` any child, `NotNode` negates its
 *     operand; the value-level counterparts behave the same way, with each
 *     leaf tested against the enclosing filter's field
 *   - a filter naming an unknown field evaluates to false rather than raising,
 *     so a typo narrows the result set instead of breaking the search
 *   - a field holding an array matches when any element matches; a scalar
 *     field matches on itself
 *   - a bare `TermNode` (no enclosing filter) matches when any field's string
 *     form matches; which fields are searchable is an application decision,
 *     and this example searches all of them
 *   - `StringNode` is a case-insensitive substring match against the field's
 *     string form, so `name:berry` finds "blueberry" and `calories:"52"`
 *     finds 52; exact matching is just as defensible
 *   - `WildcardNode` `*` means "any run of characters", anchored end to end,
 *     case-insensitive; an escaped `\*` is a literal star
 *   - `NumberNode` is numeric equality against a numeric field; against a
 *     string field it compares the field text to the literal's text
 *   - `DateTimeNode` parses a string field with `Date.parse`; equality on a
 *     date-only literal means "the same UTC calendar day", while a literal
 *     carrying a time of day demands the same instant
 *   - `ComparisonNode` is numeric or datetime ordering; a field value that
 *     cannot be coerced to the operand's kind fails rather than throws
 *   - `RangeNode` bounds are treated as inclusive on both ends
 */

/** A scalar a query leaf can be compared against. */
type Scalar = string | number;

/** Every value `Produce` can hold. Arrays are matched element-wise. */
type FieldValue = Scalar | string[];

/** True when `record` satisfies the whole query. */
export function evaluate(node: QueryNode, record: Produce): boolean {
  return node.children.every((child) => matchQuery(child, record));
}

/** The records satisfying `node`, in their original order. */
export function filterRecords(node: QueryNode, records: Produce[]): Produce[] {
  return records.filter((record) => evaluate(node, record));
}

/* ------------------------------------------------------------------ */
/* Query level                                                         */
/* ------------------------------------------------------------------ */

function matchQuery(node: QueryExpr, record: Produce): boolean {
  switch (node.type) {
    case "Filter": {
      const value = fieldValue(record, node.field);
      // Unknown field: no opinion to express, so nothing matches.
      if (value === undefined) return false;
      return matchValue(node.value, value);
    }
    case "Term":
      return Object.values(record).some((value) =>
        someScalar(value, (element) => matchScalar(node.value, element)),
      );
    case "Group":
      return node.children.every((child) => matchQuery(child, record));
    case "Not":
      return !matchQuery(node.operand, record);
    case "And":
      return node.children.every((child) => matchQuery(child, record));
    case "Or":
      return node.children.some((child) => matchQuery(child, record));
  }
}

/* ------------------------------------------------------------------ */
/* Value level — every leaf is tested against one field's value        */
/* ------------------------------------------------------------------ */

function matchValue(node: ValueExpr, value: FieldValue): boolean {
  switch (node.type) {
    case "Term":
      return someScalar(value, (element) => matchScalar(node.value, element));
    case "Comparison":
      return someScalar(value, (scalar) => matchComparison(node, scalar));
    case "Range":
      return someScalar(value, (scalar) => matchRange(node, scalar));
    case "ValueGroup":
      return node.children.every((child) => matchValue(child, value));
    case "ValueNot":
      return !matchValue(node.operand, value);
    case "ValueAnd":
      return node.children.every((child) => matchValue(child, value));
    case "ValueOr":
      return node.children.some((child) => matchValue(child, value));
  }
}

/* ------------------------------------------------------------------ */
/* Leaves                                                              */
/* ------------------------------------------------------------------ */

/** An array field matches when any element does; a scalar stands alone. */
function someScalar(
  value: FieldValue,
  test: (scalar: Scalar) => boolean,
): boolean {
  return Array.isArray(value) ? value.some(test) : test(value);
}

function matchScalar(scalar: ScalarNode, value: Scalar): boolean {
  switch (scalar.type) {
    case "String":
      return String(value).toLowerCase().includes(scalar.value.toLowerCase());
    case "Wildcard":
      return wildcardPattern(scalar.pattern).test(String(value));
    case "Number":
      if (typeof value === "number") return value === scalar.value;
      return value === scalar.raw || value === String(scalar.value);
    case "DateTime": {
      const instant = epoch(value);
      if (instant === null) return false;
      const day = new Date(instant).toISOString().slice(0, 10);
      return scalar.raw.includes("T")
        ? instant === scalar.value
        : day === new Date(scalar.value).toISOString().slice(0, 10);
    }
  }
}

function matchComparison(node: ComparisonNode, value: Scalar): boolean {
  const left = coerce(value, node.operand.type);
  if (left === null) return false;
  const right = node.operand.value;
  switch (node.operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
  }
}

/** Inclusive on both ends. The parser guarantees both bounds are one kind. */
function matchRange(node: RangeNode, value: Scalar): boolean {
  const left = coerce(value, node.from.type);
  if (left === null) return false;
  return left >= node.from.value && left <= node.to.value;
}

/* ------------------------------------------------------------------ */
/* Coercion                                                            */
/* ------------------------------------------------------------------ */

/** The field value as the operand's kind of number, or `null` if it isn't one. */
function coerce(value: Scalar, kind: "Number" | "DateTime"): number | null {
  if (kind === "DateTime") return epoch(value);
  return typeof value === "number" ? value : null;
}

/** Epoch milliseconds for a date string, or a number already in that form. */
function epoch(value: Scalar): number | null {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

/** `undefined` for a field this dataset does not have. */
function fieldValue(record: Produce, field: string): FieldValue | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return (record as unknown as Record<string, FieldValue>)[field];
}

/* ------------------------------------------------------------------ */
/* Wildcards                                                           */
/* ------------------------------------------------------------------ */

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * `*` becomes `.*`; a backslash escape contributes its escapee as literal
 * text, so `\*` is a star and `bell\ *` is "bell", a space, then anything.
 * Anchored end to end: the pattern describes the whole value.
 */
function wildcardPattern(pattern: string): RegExp {
  const chunks: string[] = [];
  let literal = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "\\") {
      const escapee = pattern[i + 1];
      if (escapee !== undefined) {
        literal += escapee;
        i++;
        continue;
      }
      literal += char;
      continue;
    }
    if (char === "*") {
      chunks.push(literal);
      literal = "";
      continue;
    }
    literal += char;
  }
  chunks.push(literal);

  const source = chunks
    .map((chunk) => chunk.replace(REGEXP_SPECIAL, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i");
}
