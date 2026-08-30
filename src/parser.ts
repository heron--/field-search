import {
  and,
  comparison,
  dateTime,
  exact,
  filter,
  group,
  not,
  number,
  or,
  query,
  range,
  term,
  valueAnd,
  valueGroup,
  valueNot,
  valueOr,
  wildcard,
  type ComparisonOperator,
  type NumericNode,
  type QueryExpr,
  type QueryNode,
  type QueryPrimary,
  type ScalarNode,
  type ValueExpr,
  type ValuePrimary,
} from "./ast";

/** Thrown for any malformed query. `position` is a 0-based index into `query`. */
export class ParseError extends Error {
  readonly position: number;
  readonly query: string;

  constructor(message: string, position: number, query: string) {
    super(`${message} (position ${position})`);
    this.name = "ParseError";
    this.position = position;
    this.query = query;
  }
}

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type TokenType =
  | "word"
  | "datetime"
  | "colon"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "minus"
  | "compare"
  | "eof";

interface Token {
  type: TokenType;
  start: number;
  /** Fully unescaped text. Words and datetimes only. */
  value: string;
  /** Source text minus quotes, escapes left intact. Words only. */
  lexeme: string;
  quoted: boolean;
  /** Contains at least one unescaped `*`. */
  wildcard: boolean;
  /** Contained at least one backslash escape. */
  escaped: boolean;
  operator: ComparisonOperator | null;
}

/** Characters that end an unquoted word. */
const WORD_TERMINATORS: Record<string, true> = {
  ":": true,
  "(": true,
  ")": true,
  "[": true,
  "]": true,
  '"': true,
  "<": true,
  ">": true,
};

/**
 * Terminators that can never legitimately abut the end of a word. `)` `]` and
 * `:` are excluded: closing a group or range, and separating a field from its
 * value, are all legal adjacencies.
 */
const ILLEGAL_ADJACENT: Record<string, true> = {
  "(": true,
  "[": true,
  '"': true,
  "<": true,
  ">": true,
};

/** A datetime literal runs until whitespace or a closing delimiter, so `:`
 *  and `-` stay available to the literal itself. */
const DATETIME_TERMINATORS: Record<string, true> = { ")": true, "]": true };

const NUMERIC = /^-?\d+(\.\d+)?$/;

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function makeToken(
  type: TokenType,
  start: number,
  extra: Partial<Token> = {},
): Token {
  return {
    type,
    start,
    value: "",
    lexeme: "",
    quoted: false,
    wildcard: false,
    escaped: false,
    operator: null,
    ...extra,
  };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const start = i;

    if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === ":") {
      const type =
        ch === "("
          ? "lparen"
          : ch === ")"
            ? "rparen"
            : ch === "["
              ? "lbracket"
              : ch === "]"
                ? "rbracket"
                : "colon";
      tokens.push(makeToken(type, start));
      i++;
      continue;
    }

    if (ch === ">" || ch === "<") {
      const operator = (
        input[i + 1] === "=" ? `${ch}=` : ch
      ) as ComparisonOperator;
      tokens.push(makeToken("compare", start, { operator }));
      i += operator.length;
      continue;
    }

    // `@` only reaches here at a scalar boundary; inside a word (`a@b`) the
    // word scanner consumes it. A literal leading `@` must be escaped.
    if (ch === "@") {
      i++;
      let literal = "";
      while (i < input.length) {
        const c = input[i]!;
        if (/\s/.test(c) || DATETIME_TERMINATORS[c]) break;
        literal += c;
        i++;
      }
      if (!ISO_DATETIME.test(literal)) {
        throw new ParseError(
          `Expected an ISO-8601 datetime after "@", got ${JSON.stringify(literal)}`,
          start,
          input,
        );
      }
      const parsed = Date.parse(literal);
      if (Number.isNaN(parsed)) {
        throw new ParseError(
          `Invalid datetime ${JSON.stringify(literal)}`,
          start,
          input,
        );
      }
      tokens.push(
        makeToken("datetime", start, { value: literal, lexeme: literal }),
      );
      continue;
    }

    // A `-` directly followed by a digit is a sign, so it belongs to the
    // number that follows; otherwise it is the negation operator. Inside a
    // word (`culinary-fruit`) the word scanner consumes it first.
    if (ch === "-" && !/\d/.test(input[i + 1] ?? "")) {
      tokens.push(makeToken("minus", start));
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      let value = "";
      let lexeme = "";
      let escaped = false;
      let hasWildcard = false;
      let closed = false;

      while (i < input.length) {
        const c = input[i]!;
        if (c === "\\") {
          const escapee = input[i + 1];
          if (escapee === undefined) {
            throw new ParseError("Dangling escape in quoted string", i, input);
          }
          value += escapee;
          lexeme += `\\${escapee}`;
          escaped = true;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "*") hasWildcard = true;
        value += c;
        lexeme += c;
        i++;
      }

      if (!closed) {
        throw new ParseError("Unterminated quoted string", start, input);
      }

      tokens.push(
        makeToken("word", start, {
          value,
          lexeme,
          quoted: true,
          wildcard: hasWildcard,
          escaped,
        }),
      );
      continue;
    }

    let value = "";
    let lexeme = "";
    let escaped = false;
    let hasWildcard = false;

    while (i < input.length) {
      const c = input[i]!;
      if (c === "\\") {
        const escapee = input[i + 1];
        if (escapee === undefined) {
          throw new ParseError("Dangling escape", i, input);
        }
        value += escapee;
        lexeme += `\\${escapee}`;
        escaped = true;
        i += 2;
        continue;
      }
      if (/\s/.test(c) || WORD_TERMINATORS[c]) {
        if (ILLEGAL_ADJACENT[c]) {
          throw new ParseError(
            `Unescaped "${c}" in value; escape it as \\${c} or quote the value`,
            i,
            input,
          );
        }
        break;
      }
      if (c === "*") hasWildcard = true;
      value += c;
      lexeme += c;
      i++;
    }

    tokens.push(
      makeToken("word", start, {
        value,
        lexeme,
        wildcard: hasWildcard,
        escaped,
      }),
    );
  }

  tokens.push(makeToken("eof", input.length));
  return tokens;
}

function describe(token: Token): string {
  switch (token.type) {
    case "eof":
      return "end of query";
    case "word":
      return JSON.stringify(token.value);
    case "datetime":
      return `"@${token.value}"`;
    case "colon":
      return '":"';
    case "lparen":
      return '"("';
    case "rparen":
      return '")"';
    case "lbracket":
      return '"["';
    case "rbracket":
      return '"]"';
    case "minus":
      return '"-"';
    case "compare":
      return JSON.stringify(token.operator);
  }
}

/** Numeric lexemes are unquoted, unescaped, wildcard-free signed digit runs. */
function numericValue(token: Token): number | null {
  if (token.type !== "word") return null;
  if (token.quoted || token.escaped || token.wildcard) return null;
  if (!NUMERIC.test(token.value)) return null;
  return Number.parseFloat(token.value);
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly input: string,
  ) {}

  parse(): QueryNode {
    if (this.at("eof")) {
      throw new ParseError("Cannot parse an empty query", 0, this.input);
    }
    const children = this.queryList();
    if (!this.at("eof")) {
      const token = this.peek();
      this.fail(`Unexpected ${describe(token)}`, token);
    }
    return query(children);
  }

  /* -- token helpers -- */

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++]!;
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private isKeyword(token: Token, keyword: string): boolean {
    return (
      token.type === "word" &&
      !token.quoted &&
      !token.escaped &&
      !token.wildcard &&
      token.value === keyword
    );
  }

  private fail(message: string, token: Token): never {
    throw new ParseError(message, token.start, this.input);
  }

  /* -- query level: juxtaposition < OR < AND < "-" -- */

  private startsQueryPrimary(): boolean {
    const token = this.peek();
    if (token.type === "lparen") return true;
    if (token.type === "datetime") return true;
    if (token.type !== "word") return false;
    return !this.isKeyword(token, "AND") && !this.isKeyword(token, "OR");
  }

  private startsQueryExpr(): boolean {
    return this.at("minus") || this.startsQueryPrimary();
  }

  /** A juxtaposed run of expressions — the root, and a group's contents. */
  private queryList(): QueryExpr[] {
    const children: QueryExpr[] = [];
    while (this.startsQueryExpr()) {
      children.push(this.queryOr());
    }
    return children;
  }

  private queryOr(): QueryExpr {
    const children: QueryExpr[] = [this.queryAnd()];
    while (this.isKeyword(this.peek(), "OR")) {
      this.advance();
      if (!this.startsQueryExpr()) {
        this.fail('Expected an operand after "OR"', this.peek());
      }
      children.push(this.queryAnd());
    }
    return children.length === 1 ? children[0]! : or(children);
  }

  private queryAnd(): QueryExpr {
    const children: QueryExpr[] = [this.queryUnary()];
    while (this.isKeyword(this.peek(), "AND")) {
      this.advance();
      if (!this.startsQueryExpr()) {
        this.fail('Expected an operand after "AND"', this.peek());
      }
      children.push(this.queryUnary());
    }
    return children.length === 1 ? children[0]! : and(children);
  }

  private queryUnary(): QueryExpr {
    if (this.at("minus")) {
      const minus = this.advance();
      if (this.at("minus")) {
        this.fail('Double negation is not allowed; write "-(-x)"', minus);
      }
      if (!this.startsQueryPrimary()) {
        this.fail('Expected an operand after "-"', this.peek());
      }
      return not(this.queryPrimary());
    }
    return this.queryPrimary();
  }

  private queryPrimary(): QueryPrimary {
    const token = this.peek();

    if (token.type === "lparen") {
      this.advance();
      const children = this.queryList();
      if (children.length === 0) this.fail("Empty group", token);
      if (!this.at("rparen")) this.fail('Unclosed "("', token);
      this.advance();
      return group(children);
    }

    if (token.type === "word" && this.peek(1).type === "colon") {
      this.advance();
      this.advance();
      return filter(token.value, this.filterValue(token));
    }

    if (token.type === "word" || token.type === "datetime") {
      return term(this.scalar(this.advance()));
    }

    return this.fail(`Unexpected ${describe(token)}`, token);
  }

  /* -- value level -- */

  private startsValuePrimary(): boolean {
    const token = this.peek();
    if (
      token.type === "lparen" ||
      token.type === "lbracket" ||
      token.type === "compare" ||
      token.type === "datetime"
    ) {
      return true;
    }
    if (token.type !== "word") return false;
    return !this.isKeyword(token, "AND") && !this.isKeyword(token, "OR");
  }

  /**
   * The slot after `field:` holds exactly one primary. Operators are rejected
   * here by design — they belong to expressions, and an expression needs a
   * group.
   */
  private filterValue(field: Token): ValuePrimary {
    if (this.at("minus")) {
      this.fail(
        `"-" is an operator and cannot start a value; write ${field.value}:(-…) to negate`,
        this.peek(),
      );
    }
    if (!this.startsValuePrimary()) {
      this.fail(`Expected a value after "${field.value}:"`, this.peek());
    }
    return this.valuePrimary();
  }

  private valueList(): ValueExpr[] {
    const children: ValueExpr[] = [];
    while (this.at("minus") || this.startsValuePrimary()) {
      children.push(this.valueOr());
    }
    return children;
  }

  private valueOr(): ValueExpr {
    const children: ValueExpr[] = [this.valueAnd()];
    while (this.isKeyword(this.peek(), "OR")) {
      this.advance();
      if (!this.at("minus") && !this.startsValuePrimary()) {
        this.fail('Expected an operand after "OR"', this.peek());
      }
      children.push(this.valueAnd());
    }
    return children.length === 1 ? children[0]! : valueOr(children);
  }

  private valueAnd(): ValueExpr {
    const children: ValueExpr[] = [this.valueUnary()];
    while (this.isKeyword(this.peek(), "AND")) {
      this.advance();
      if (!this.at("minus") && !this.startsValuePrimary()) {
        this.fail('Expected an operand after "AND"', this.peek());
      }
      children.push(this.valueUnary());
    }
    return children.length === 1 ? children[0]! : valueAnd(children);
  }

  private valueUnary(): ValueExpr {
    if (this.at("minus")) {
      const minus = this.advance();
      if (this.at("minus")) {
        this.fail('Double negation is not allowed; write "-(-x)"', minus);
      }
      if (!this.startsValuePrimary()) {
        this.fail('Expected an operand after "-"', this.peek());
      }
      return valueNot(this.valuePrimary());
    }
    return this.valuePrimary();
  }

  private valuePrimary(): ValuePrimary {
    const token = this.peek();

    if (token.type === "lparen") {
      this.advance();
      const children = this.valueList();
      if (children.length === 0) this.fail("Empty group", token);
      if (!this.at("rparen")) this.fail('Unclosed "("', token);
      this.advance();
      return valueGroup(children);
    }

    if (token.type === "lbracket") return this.range();

    if (token.type === "compare") {
      this.advance();
      if (!this.at("word") && !this.at("datetime")) {
        this.fail(
          `Expected a number or datetime after "${token.operator}"`,
          this.peek(),
        );
      }
      return comparison(token.operator!, this.numeric(this.advance()));
    }

    if (token.type === "word" || token.type === "datetime") {
      if (this.peek(1).type === "colon") {
        this.fail("A field filter cannot appear inside a value", token);
      }
      return term(this.scalar(this.advance()));
    }

    return this.fail(`Unexpected ${describe(token)}`, token);
  }

  private range(): ValuePrimary {
    const open = this.advance();

    const fromToken = this.peek();
    if (
      (fromToken.type !== "word" && fromToken.type !== "datetime") ||
      this.isKeyword(fromToken, "TO")
    ) {
      this.fail("Expected a number or datetime to start the range", fromToken);
    }
    const from = this.numeric(this.advance());

    if (!this.isKeyword(this.peek(), "TO")) {
      this.fail('Expected "TO" in range', this.peek());
    }
    this.advance();

    const toToken = this.peek();
    if (toToken.type !== "word" && toToken.type !== "datetime") {
      this.fail("Expected a number or datetime to end the range", toToken);
    }
    const to = this.numeric(this.advance());

    if (from.type !== to.type) {
      this.fail("Range bounds must be the same kind", open);
    }

    if (!this.at("rbracket")) this.fail('Unclosed "[" in range', open);
    this.advance();

    return range(from, to);
  }

  /* -- leaves -- */

  private scalar(token: Token): ScalarNode {
    if (token.type === "datetime") {
      return dateTime(Date.parse(token.value), token.value);
    }
    if (token.wildcard) return wildcard(token.lexeme, token.quoted);
    const value = numericValue(token);
    if (value !== null) return number(value, token.value);
    return exact(token.value, token.quoted);
  }

  private numeric(token: Token): NumericNode {
    if (token.type === "datetime") {
      return dateTime(Date.parse(token.value), token.value);
    }
    const value = numericValue(token);
    if (value === null) {
      this.fail(
        `Expected a number or datetime, got ${JSON.stringify(token.value)}`,
        token,
      );
    }
    return number(value, token.value);
  }
}

/** Parse a query string into a `QueryNode`. Throws `ParseError`. */
export function parse(input: string): QueryNode {
  return new Parser(tokenize(input), input).parse();
}
