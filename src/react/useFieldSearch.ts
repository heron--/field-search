import * as React from "react";
import type { QueryNode } from "../ast";
import type { ParseError } from "../parser";
import {
  caretTarget,
  segmentWithErrors,
  type CaretTarget,
  type Segment,
} from "./segments";

/** A field the default suggestion provider can offer. */
export interface FieldSuggestion {
  field: string;
  /** Muted hint shown beside the field name. */
  detail?: React.ReactNode;
  values?: string[];
}

/** An item displayed by the suggestion list. */
export interface SuggestionItem {
  /** Stable identity. Falls back to `insert` when omitted. */
  id?: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  /** Text spliced into the query when the item is accepted. */
  insert: string;
  disabled?: boolean;
}

/** The current editing and parsing state. */
export interface SearchContext {
  /** Caret offset into `value`. */
  caret: number;
  target: CaretTarget;
  ast: QueryNode | null;
  error: ParseError | null;
  segments: Segment[];
  /** Empty queries are valid; incomplete or malformed queries are not. */
  valid: boolean;
}

export interface SearchMutation {
  value: string;
  caret: number;
  context: SearchContext;
}

export interface UseFieldSearchOptions {
  value: string;
  onValueChange: (value: string, context: SearchContext) => void;
  fields?: FieldSuggestion[];
  /** Fully controlled suggestions. When supplied, `fields` is ignored. */
  suggestions?: SuggestionItem[];
  /** Notifies on caret movement as well as value changes. */
  onContextChange?: (context: SearchContext) => void;
}

export interface FieldSearchController {
  caret: number;
  context: SearchContext;
  segments: Segment[];
  items: SuggestionItem[];
  validation: {
    ast: QueryNode | null;
    error: ParseError | null;
  };
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setCaret: (caret: number) => void;
  commit: (value: string, caret: number) => SearchMutation;
  accept: (item: SuggestionItem) => SearchMutation | null;
  removeSegment: (segmentIndex: number) => SearchMutation | null;
  pendingCaretRef: React.MutableRefObject<number | null>;
}

/** Build the context passed through the public callbacks. */
export function createSearchContext(
  value: string,
  caret: number,
): SearchContext {
  const next = segmentWithErrors(value);
  return {
    caret,
    target: caretTarget(value, caret),
    ast: next.validation.ast,
    error: next.validation.error,
    segments: next.segments,
    valid:
      next.validation.error === null &&
      !next.segments.some((segment) => segment.error),
  };
}

/** The built-in field/value matcher used by the convenience component. */
export function defaultSuggestions(
  fields: FieldSuggestion[],
  target: CaretTarget,
): SuggestionItem[] {
  const fragment = target.fragment.toLowerCase();

  if (target.kind === "value") {
    const match = fields.find((field) => field.field === target.field);
    return (match?.values ?? [])
      .filter((value) => value.toLowerCase().includes(fragment))
      .map((value) => ({
        id: `${match?.field ?? "value"}:${value}`,
        label: value,
        detail: match?.field,
        insert: /[\s()"]/.test(value) ? `"${value}"` : value,
      }));
  }

  return fields
    .filter((field) => field.field.toLowerCase().includes(fragment))
    .map((field) => ({
      id: `field:${field.field}`,
      label: `${field.field}:`,
      detail: field.detail ?? `${field.values?.length ?? 0} values`,
      insert: `${field.field}:`,
    }));
}

/**
 * Headless state for a field-search editor.
 *
 * It owns no markup, popover, or styles. Consumers can use this directly when
 * the bundled `SearchInput` structure is not a good fit.
 */
export function useFieldSearch({
  value,
  onValueChange,
  fields = [],
  suggestions,
  onContextChange,
}: UseFieldSearchOptions): FieldSearchController {
  const [caret, setCaretState] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const pendingCaretRef = React.useRef<number | null>(null);

  const { segments, validation } = React.useMemo(
    () => segmentWithErrors(value),
    [value],
  );
  const target = React.useMemo(() => caretTarget(value, caret), [value, caret]);
  const context = React.useMemo<SearchContext>(
    () => ({
      caret,
      target,
      ast: validation.ast,
      error: validation.error,
      segments,
      valid:
        validation.error === null && !segments.some((segment) => segment.error),
    }),
    [caret, segments, target, validation.ast, validation.error],
  );

  const derivedItems = React.useMemo(
    () => defaultSuggestions(fields, target),
    [fields, target],
  );
  const items = suggestions ?? derivedItems;

  React.useEffect(() => {
    onContextChange?.(context);
  }, [context, onContextChange]);

  React.useEffect(() => {
    setActiveIndex((current) => {
      if (items.length === 0) return -1;
      if (current >= 0 && current < items.length && !items[current]?.disabled) {
        return current;
      }
      const firstEnabled = items.findIndex((item) => !item.disabled);
      return firstEnabled;
    });
  }, [items]);

  const setCaret = React.useCallback(
    (nextCaret: number) => {
      setCaretState(Math.max(0, Math.min(nextCaret, value.length)));
    },
    [value.length],
  );

  const commit = React.useCallback(
    (nextValue: string, nextCaret: number) => {
      const nextContext = createSearchContext(nextValue, nextCaret);
      pendingCaretRef.current = nextCaret;
      setCaretState(nextCaret);
      onValueChange(nextValue, nextContext);
      return { value: nextValue, caret: nextCaret, context: nextContext };
    },
    [onValueChange],
  );

  const accept = React.useCallback(
    (item: SuggestionItem) => {
      if (item.disabled) return null;
      const head = value.slice(0, target.replaceFrom);
      const tail = value.slice(caret);
      return commit(
        `${head}${item.insert}${tail}`,
        target.replaceFrom + item.insert.length,
      );
    },
    [caret, commit, target.replaceFrom, value],
  );

  const removeSegment = React.useCallback(
    (segmentIndex: number) => {
      const segment = segments[segmentIndex];
      if (!segment) return null;
      const after = segments[segmentIndex + 1];
      const end = after?.kind === "space" ? after.end : segment.end;
      const before = segments[segmentIndex - 1];
      const start =
        !after && before?.kind === "space" ? before.start : segment.start;
      return commit(value.slice(0, start) + value.slice(end), start);
    },
    [commit, segments, value],
  );

  return {
    caret,
    context,
    segments,
    items,
    validation,
    activeIndex,
    setActiveIndex,
    setCaret,
    commit,
    accept,
    removeSegment,
    pendingCaretRef,
  };
}
