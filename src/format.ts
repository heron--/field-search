import {
  type FilterNode,
  type QueryExpr,
  type QueryNode,
  type ScalarNode,
  type StringNode,
  type ValueExpr,
} from "./ast";

/**
 * Render a query tree back to string form.
 *
 * Trees from `parse` round-trip exactly: `raw` preserves numeric lexemes,
 * `quoted` preserves quoting, and every source paren pair is its own
 * `GroupNode`. Hand-built trees additionally get parens synthesized wherever
 * an operator nests inside a tighter one, since precedence would otherwise
 * re-associate them on the way back in.
 */

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

/** Structural characters, special wherever they appear unquoted. */
const BARE_ESCAPE: Record<string, true> = {
  ":": true,
  "(": true,
  ")": true,
  "[": true,
  "]": true,
  '"': true,
  "*": true,
  "\\": true,
  ">": true,
  "<": true,
};

/** Escaped inside quotes: the delimiter, the escape, and `*` — the last so an
 *  exact value never re-parses as a wildcard. */
const QUOTED_ESCAPE: Record<string, true> = {
  '"': true,
  "\\": true,
  "*": true,
};

const KEYWORDS: Record<string, true> = { AND: true, OR: true, TO: true };

const NUMERIC = /^-?\d+(\.\d+)?$/;

function escapeQuoted(value: string): string {
  let out = "";
  for (const ch of value) {
    if (QUOTED_ESCAPE[ch]) out += "\\";
    out += ch;
  }
  return out;
}

/**
 * Escape a value written without quotes.
 *
 * `maskNumeric` masks a value that would otherwise re-lex as a number. Field
 * names do not need it — the following `:` already forces the word reading —
 * and masking them would break round-tripping of `5:x`.
 */
function escapeBare(value: string, maskNumeric: boolean): string {
  // A leading backslash defeats the keyword and numeric lexer rules, because
  // an escaped word is neither.
  const mask = KEYWORDS[value] === true || (maskNumeric && NUMERIC.test(value));

  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const structural = BARE_ESCAPE[ch] === true || /\s/.test(ch);
    // `-` and `@` only carry meaning at the start of a scalar.
    const positional = i === 0 && (ch === "-" || ch === "@" || mask);
    if (structural || positional) out += "\\";
    out += ch;
  }
  return out;
}

function renderString(node: StringNode): string {
  if (node.quoted) return `"${escapeQuoted(node.value)}"`;
  // An empty value has no bare spelling.
  if (node.value === "") return '""';
  return escapeBare(node.value, true);
}

function renderScalar(node: ScalarNode): string {
  switch (node.type) {
    case "String":
      return renderString(node);
    case "Wildcard":
      // `pattern` is lexeme-form: unescaped `*` are wildcards, literals are
      // already backslash-escaped, so it emits verbatim.
      return node.quoted ? `"${node.pattern}"` : node.pattern;
    case "Number":
      return node.raw;
    case "DateTime":
      return `@${node.raw}`;
  }
}

/**
 * Prefix a rendered operand with the negation operator.
 *
 * A `-` directly followed by a digit lexes as a numeric sign, so an operand
 * that starts with one — `5`, `5:x`, `5abc` — has to be delimited or it comes
 * back as a negative number instead of a negation. Only hand-built trees can
 * reach this; `parse` never produces it.
 */
function negate(operand: string): string {
  return /^\d/.test(operand) ? `-(${operand})` : `-${operand}`;
}

/* ------------------------------------------------------------------ */
/* Value level                                                         */
/* ------------------------------------------------------------------ */

function renderValue(node: ValueExpr): string {
  switch (node.type) {
    case "Term":
      return renderScalar(node.value);
    case "Comparison":
      return `${node.operator}${renderScalar(node.operand)}`;
    case "Range":
      return `[${renderScalar(node.from)} TO ${renderScalar(node.to)}]`;
    case "ValueGroup":
      return `(${node.children.map(renderValue).join(" ")})`;
    case "ValueNot":
      return negate(renderValue(node.operand));
    case "ValueAnd":
      // OR binds looser, so an OR child needs parens to survive the round trip.
      return node.children
        .map((child) =>
          child.type === "ValueOr"
            ? `(${renderValue(child)})`
            : renderValue(child),
        )
        .join(" AND ");
    case "ValueOr":
      return node.children.map(renderValue).join(" OR ");
  }
}

/* ------------------------------------------------------------------ */
/* Query level                                                         */
/* ------------------------------------------------------------------ */

function renderFilter(node: FilterNode): string {
  return `${escapeBare(node.field, false)}:${renderValue(node.value)}`;
}

function renderQuery(node: QueryExpr): string {
  switch (node.type) {
    case "Filter":
      return renderFilter(node);
    case "Term":
      return renderScalar(node.value);
    case "Group":
      return `(${node.children.map(renderQuery).join(" ")})`;
    case "Not":
      return negate(renderQuery(node.operand));
    case "And":
      return node.children
        .map((child) =>
          child.type === "Or" ? `(${renderQuery(child)})` : renderQuery(child),
        )
        .join(" AND ");
    case "Or":
      return node.children.map(renderQuery).join(" OR ");
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Render a query tree back to string form. */
export function format(node: QueryNode): string {
  return node.children.map(renderQuery).join(" ");
}
