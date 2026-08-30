import * as React from "react";
import type { Segment } from "./segments";

/**
 * A highlighted piece of chip text.
 *
 * Highlighting runs over the raw source rather than the AST, because a chip is
 * frequently mid-edit and will not parse. Quoted runs are emitted whole, which
 * is what keeps a paren inside a string from being painted as punctuation.
 */
interface Piece {
  cls: string;
  text: string;
}

const PUNCT = "()[]<>=:";
const KEYWORDS: Record<string, true> = { AND: true, OR: true, TO: true };
const NUMBER = /^-?\d+(\.\d+)?$/;

/** Split the value side of a chip into classified pieces. */
function highlightValue(value: string): Piece[] {
  const pieces: Piece[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer === "") return;
    const cls = KEYWORDS[buffer]
      ? "fs-operator"
      : NUMBER.test(buffer)
        ? "fs-number"
        : "";
    pieces.push({ cls, text: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < value.length) {
    const ch = value[i]!;

    if (ch === "\\") {
      buffer += value.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === '"') {
      flush();
      const start = i;
      i++;
      while (i < value.length) {
        if (value[i] === "\\") {
          i += 2;
          continue;
        }
        if (value[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      pieces.push({ cls: "fs-string", text: value.slice(start, i) });
      continue;
    }

    if (PUNCT.includes(ch)) {
      flush();
      pieces.push({ cls: "fs-punct", text: ch });
      i++;
      continue;
    }

    if (ch === " ") {
      flush();
      pieces.push({ cls: "", text: ch });
      i++;
      continue;
    }

    buffer += ch;
    i++;
  }

  flush();
  return pieces;
}
export interface ChipClassNames {
  negate?: string;
  field?: string;
  punctuation?: string;
  operator?: string;
  string?: string;
  number?: string;
}

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  segment: Segment;
  hovered?: boolean;
  /** Errors stay hidden while the field has focus; see SearchInput. */
  showError?: boolean;
  classNames?: ChipClassNames;
  /**
   * Trailing content rendered inside the chip's own box, after its text —
   * e.g. a remove control. Keeping it inside the same element means it
   * automatically shares the chip's background, radius, and elevation
   * instead of needing separately coordinated styling.
   */
  end?: React.ReactNode;
}

/**
 * One chip: a bare term, or a `field:value` filter.
 *
 * Renders inside a `pointer-events: none` layer sitting behind a transparent
 * input, so it carries no interaction of its own — hover is tracked by the
 * input via hit-testing, and the close button is rendered above the input.
 */
function join(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  {
    segment,
    hovered = false,
    showError = true,
    className,
    classNames = {},
    children,
    title,
    end,
    ...props
  },
  ref,
) {
  const { text, colon, negated, error } = segment;
  const fault = showError ? error : undefined;

  const head = negated ? 1 : 0;
  const hasField = colon >= 0;
  const field = hasField ? text.slice(head, colon) : "";
  const value = hasField ? text.slice(colon + 1) : text.slice(head);

  const pieceClassName = (piece: Piece) => {
    if (piece.cls === "fs-operator") {
      return join(piece.cls, classNames.operator);
    }
    if (piece.cls === "fs-string") return join(piece.cls, classNames.string);
    if (piece.cls === "fs-number") return join(piece.cls, classNames.number);
    if (piece.cls === "fs-punct") {
      return join(piece.cls, classNames.punctuation);
    }
    return undefined;
  };

  const content = children ?? (
    <>
      {negated && (
        <span
          className={join("fs-negate", classNames.negate)}
          data-slot="chip-negate"
        >
          -
        </span>
      )}
      {hasField && (
        <>
          <span
            className={join("fs-field-name", classNames.field)}
            data-slot="chip-field"
          >
            {field}
          </span>
          <span
            className={join("fs-punct", classNames.punctuation)}
            data-slot="chip-punctuation"
          >
            :
          </span>
        </>
      )}
      {highlightValue(value).map((piece, index) => (
        <span
          key={index}
          className={pieceClassName(piece)}
          data-slot="chip-value"
        >
          {piece.text}
        </span>
      ))}
    </>
  );

  return (
    <span
      {...props}
      ref={ref}
      className={join(end ? "fs-chip fs-active-chip" : "fs-chip", className)}
      data-slot="chip"
      data-negated={negated || undefined}
      data-hovered={hovered || undefined}
      data-invalid={fault ? true : undefined}
      title={title ?? fault}
    >
      {end ? <span aria-hidden="true">{content}</span> : content}
      {end}
    </span>
  );
});
