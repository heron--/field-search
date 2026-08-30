import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import type { ParseError } from "../parser";
import type { QueryNode } from "../ast";
import { Chip } from "./Chip";
import { Suggestions, type SuggestionItem } from "./Suggestions";
import {
  caretTarget,
  segmentWithErrors,
  type CaretTarget,
  type Segment,
} from "./segments";

/** A field the input can suggest, with the values it accepts. */
export interface FieldSuggestion {
  field: string;
  /** Muted hint shown beside the field name. */
  detail?: string;
  values?: string[];
}

/** Everything a caller needs to react to a keystroke or fetch options. */
export interface SearchContext {
  /** Caret offset into `value`. */
  caret: number;
  /** Whether the caret sits in a field name or a value, and which field. */
  target: CaretTarget;
  /** The parsed tree, or `null` while the query is incomplete or invalid. */
  ast: QueryNode | null;
  /** Why it failed to parse, when it did. */
  error: ParseError | null;
  segments: Segment[];
}

/** Per-part class hooks, for Tailwind or any other styling approach. */
export interface SearchInputClassNames {
  root?: string;
  field?: string;
  layer?: string;
  input?: string;
  chip?: string;
  close?: string;
  operator?: string;
  paren?: string;
  suggestions?: string;
  error?: string;
}

export interface SearchInputProps {
  /** Controlled: the query string itself. Chips are derived from it. */
  value: string;
  onChange: (value: string, context: SearchContext) => void;
  /** Fired on Enter, when no suggestion is being accepted. */
  onSearch?: (value: string, context: SearchContext) => void;
  fields?: FieldSuggestion[];
  placeholder?: string;
  className?: string;
  classNames?: SearchInputClassNames;
  /**
   * Drop the bundled theme, keeping only the structural layout that the
   * overlay needs. Style `.fs-*` yourself, or pass `classNames`.
   */
  unstyled?: boolean;
  /** Render the parse error beneath the field. */
  showError?: boolean;
}

/** Characters that auto-close, and what closes them. */
const PAIRS: Record<string, string> = { '"': '"', "(": ")", "[": "]" };
const CLOSERS: Record<string, true> = { '"': true, ")": true, "]": true };

/** Fallbacks matching layout.css, used when the stylesheet is absent. */
const DEFAULT_GEOMETRY = { spread: 3, closeWidth: 12 };

/**
 * Chip geometry lives in CSS so retuning is a pure stylesheet change, and is
 * read back here so the hover region and the close section's position cannot
 * drift from what is actually painted.
 */
function readGeometry(node: HTMLElement | null) {
  if (!node) return DEFAULT_GEOMETRY;
  const style = getComputedStyle(node);
  const spread = Number.parseFloat(style.getPropertyValue("--fs-chip-spread"));
  const closeWidth = Number.parseFloat(
    style.getPropertyValue("--fs-close-width"),
  );
  return {
    spread: Number.isFinite(spread) ? spread : DEFAULT_GEOMETRY.spread,
    closeWidth: Number.isFinite(closeWidth)
      ? closeWidth
      : DEFAULT_GEOMETRY.closeWidth,
  };
}

interface Measured {
  index: number;
  left: number;
  top: number;
  height: number;
}

export function SearchInput({
  value,
  onChange,
  onSearch,
  fields = [],
  placeholder,
  className,
  classNames = {},
  unstyled = false,
  showError = true,
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const chipRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const geometry = React.useRef(DEFAULT_GEOMETRY);

  const [caret, setCaret] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState<Measured | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const { segments, validation } = React.useMemo(
    () => segmentWithErrors(value),
    [value],
  );
  const target = React.useMemo(() => caretTarget(value, caret), [value, caret]);

  const context = React.useCallback(
    (nextValue: string, nextCaret: number): SearchContext => {
      const next = segmentWithErrors(nextValue);
      return {
        caret: nextCaret,
        target: caretTarget(nextValue, nextCaret),
        ast: next.validation.ast,
        error: next.validation.error,
        segments: next.segments,
      };
    },
    [],
  );

  /* ---------- suggestions ---------- */

  const items = React.useMemo<SuggestionItem[]>(() => {
    const fragment = target.fragment.toLowerCase();

    if (target.kind === "value") {
      const match = fields.find((f) => f.field === target.field);
      return (match?.values ?? [])
        .filter((v) => v.toLowerCase().includes(fragment))
        .map((v) => ({
          label: v,
          detail: match?.field,
          insert: /[\s()"]/.test(v) ? `"${v}"` : v,
        }));
    }

    return fields
      .filter((f) => f.field.toLowerCase().includes(fragment))
      .map((f) => ({
        label: `${f.field}:`,
        detail: f.detail ?? `${f.values?.length ?? 0} values`,
        insert: `${f.field}:`,
      }));
  }, [fields, target]);

  React.useEffect(() => setActiveIndex(0), [target.kind, target.fragment]);

  const open = focused && items.length > 0;

  /* ---------- editing ---------- */

  // Restoring the caret on a rAF loses races against fast input: the next
  // keystroke arrives before the callback runs and lands at a stale offset.
  // A layout effect applies it synchronously with the DOM update instead.
  const pendingCaret = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const position = pendingCaret.current;
    if (position === null) return;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(position, position);
  });

  const commit = React.useCallback(
    (nextValue: string, nextCaret: number) => {
      pendingCaret.current = nextCaret;
      setCaret(nextCaret);
      onChange(nextValue, context(nextValue, nextCaret));
    },
    [context, onChange],
  );

  const accept = React.useCallback(
    (item: SuggestionItem) => {
      const head = value.slice(0, target.replaceFrom);
      const tail = value.slice(caret);
      commit(
        `${head}${item.insert}${tail}`,
        target.replaceFrom + item.insert.length,
      );
    },
    [caret, commit, target.replaceFrom, value],
  );

  const removeSegment = React.useCallback(
    (segmentIndex: number) => {
      const seg = segments[segmentIndex];
      if (!seg) return;
      // Take the trailing space with the chip so removal never leaves a gap.
      const after = segments[segmentIndex + 1];
      const end = after?.kind === "space" ? after.end : seg.end;
      const before = segments[segmentIndex - 1];
      const start =
        !after && before?.kind === "space" ? before.start : seg.start;
      commit(value.slice(0, start) + value.slice(end), start);
      setHovered(null);
    },
    [commit, segments, value],
  );

  const syncCaret = React.useCallback(() => {
    setCaret(inputRef.current?.selectionStart ?? 0);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;

    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (
        event.key === "Tab" ||
        (event.key === "Enter" && items[activeIndex])
      ) {
        event.preventDefault();
        accept(items[activeIndex]!);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onSearch?.(value, context(value, start));
      return;
    }

    if (event.key === "Escape") {
      setFocused(false);
      return;
    }

    // Typing a closer where one already sits just steps over it.
    if (CLOSERS[event.key] && start === end && value[start] === event.key) {
      event.preventDefault();
      commit(value, start + 1);
      return;
    }

    const closer = PAIRS[event.key];
    if (closer && start === end) {
      event.preventDefault();
      const next = `${value.slice(0, start)}${event.key}${closer}${value.slice(start)}`;
      commit(next, start + 1);
      return;
    }
  };

  /* ---------- hover hit-testing ---------- */

  // The layer is `pointer-events: none` so the input can own the caret, which
  // means chips never get :hover. Hit-test their rects against the pointer
  // instead. The close section counts as part of the chip's hover region —
  // otherwise moving onto the button leaves the chip, which unmounts the
  // button out from under the cursor before the click can land.
  const handleMouseMove = (event: React.MouseEvent) => {
    const layer = layerRef.current;
    if (!layer) return;
    const bounds = layer.getBoundingClientRect();
    const { clientX, clientY } = event;
    const { spread, closeWidth } = geometry.current;

    for (let i = 0; i < chipRefs.current.length; i++) {
      const node = chipRefs.current[i];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      // The pill paints `spread` past the text box on every side, and the
      // close section sits just beyond it, in the gap before the next chip.
      const within =
        clientX >= rect.left - spread &&
        clientX <= rect.right + spread + closeWidth &&
        clientY >= rect.top - spread &&
        clientY <= rect.bottom + spread;

      if (within) {
        setHovered({
          index: i,
          left: rect.right - bounds.left + spread,
          top: rect.top - bounds.top - spread,
          height: rect.height + spread * 2,
        });
        return;
      }
    }
    setHovered(null);
  };

  // Re-read once per hover session rather than per event: cheap, and picks up
  // a retheme without watching for style changes.
  const handleMouseEnter = () => {
    geometry.current = readGeometry(rootRef.current);
  };

  const syncScroll = () => {
    const layer = layerRef.current;
    const input = inputRef.current;
    if (layer && input) layer.scrollLeft = input.scrollLeft;
  };

  // A half-typed `name:` is not a mistake, it is an unfinished thought.
  // Errors stay hidden while the field has focus and surface on blur.
  const revealErrors = !focused;
  const invalid = revealErrors && segments.some((s) => s.error);

  const themed = unstyled ? "" : " fs-theme";
  const join = (base: string, extra?: string) =>
    extra ? `${base} ${extra}` : base;

  return (
    <div
      ref={rootRef}
      className={join(
        `fs-root${themed}`,
        [className, classNames.root].filter(Boolean).join(" ") || undefined,
      )}
    >
      <Popover.Root open={open}>
        <Popover.Anchor asChild>
          <div
            className={join("fs-field", classNames.field)}
            data-invalid={invalid || undefined}
            onMouseEnter={handleMouseEnter}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className={join("fs-layer", classNames.layer)}
              ref={layerRef}
              aria-hidden="true"
            >
              {segments.map((seg, index) => {
                if (seg.kind === "chip") {
                  return (
                    <Chip
                      key={`${seg.start}-${seg.text}`}
                      segment={seg}
                      hovered={hovered?.index === index}
                      showError={revealErrors}
                      className={classNames.chip}
                      elementRef={(node) => {
                        chipRefs.current[index] = node;
                      }}
                    />
                  );
                }
                chipRefs.current[index] = null;
                const cls =
                  seg.kind === "operator"
                    ? join("fs-operator", classNames.operator)
                    : seg.kind === "paren"
                      ? join("fs-top-paren", classNames.paren)
                      : undefined;
                return (
                  <span key={`${seg.start}-${seg.kind}`} className={cls}>
                    {seg.text}
                  </span>
                );
              })}
            </div>

            <input
              ref={inputRef}
              className={join("fs-native", classNames.input)}
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={value}
              placeholder={placeholder}
              onChange={(event) => {
                const next = event.target.value;
                const position = event.target.selectionStart ?? next.length;
                setCaret(position);
                onChange(next, context(next, position));
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onSelect={syncCaret}
              onScroll={syncScroll}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            />

            {hovered && segments[hovered.index] && (
              <button
                type="button"
                className={join("fs-close", classNames.close)}
                data-negated={segments[hovered.index]!.negated || undefined}
                style={{
                  left: hovered.left,
                  top: hovered.top,
                  height: hovered.height,
                }}
                aria-label={`Remove ${segments[hovered.index]!.text}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => removeSegment(hovered.index)}
              >
                ×
              </button>
            )}
          </div>
        </Popover.Anchor>

        <Popover.Portal>
          <Popover.Content
            className={`fs-suggestions-wrap${themed}`}
            side="bottom"
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Suggestions
              items={items}
              activeIndex={activeIndex}
              className={classNames.suggestions}
              header={
                target.kind === "value"
                  ? `Values for ${target.field}`
                  : "Filter by"
              }
              onSelect={accept}
              onActiveIndexChange={setActiveIndex}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {showError && revealErrors && validation.error && (
        <div className={join("fs-error", classNames.error)}>
          {validation.error.message}
        </div>
      )}
    </div>
  );
}
