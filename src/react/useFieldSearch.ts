import * as React from "react";
import type { QueryNode } from "../ast";
import type { ParseError } from "../parser";
import { useHistory } from "./history";
import { collapsed, ordered, type EditorSelection } from "./selection";
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
  /** Caret offset into `value`. Equal to `selection.focus`. */
  caret: number;
  /** Full selection. Collapsed when nothing is selected. */
  selection: EditorSelection;
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
  selection: EditorSelection;
  context: SearchContext;
}

export interface CommitOptions {
  /**
   * How the edit enters the undo stack. `coalesce` merges it into the previous
   * run of coalesced edits, which is what keeps typing from producing one undo
   * step per character. `skip` is for applying history itself.
   */
  history?: "push" | "coalesce" | "skip";
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
  selection: EditorSelection;
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
  setSelection: (selection: EditorSelection) => void;
  commit: (
    value: string,
    selection: number | EditorSelection,
    options?: CommitOptions,
  ) => SearchMutation;
  accept: (item: SuggestionItem) => SearchMutation | null;
  removeSegment: (segmentIndex: number) => SearchMutation | null;
  undo: () => SearchMutation | null;
  redo: () => SearchMutation | null;
  /**
   * Selection to restore once the render driven by the last `commit` has been
   * applied to the DOM. Read and clear it from a layout effect.
   */
  pendingSelectionRef: React.MutableRefObject<EditorSelection | null>;
}

/** Build the context passed through the public callbacks. */
export function createSearchContext(
  value: string,
  selection: number | EditorSelection,
): SearchContext {
  const resolved =
    typeof selection === "number" ? collapsed(selection) : selection;
  const next = segmentWithErrors(value);
  return {
    caret: resolved.focus,
    selection: resolved,
    target: caretTarget(value, resolved.focus),
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
  const [selectionState, setSelectionState] = React.useState<EditorSelection>(
    () => collapsed(0),
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const pendingSelectionRef = React.useRef<EditorSelection | null>(null);
  const history = useHistory(value);
  /** The last value this controller put into history, committed or observed. */
  const recordedRef = React.useRef(value);

  // Clamping here rather than in the setter keeps the setter free of any
  // dependency on the current value, so listeners never need re-subscribing.
  const selection = React.useMemo<EditorSelection>(
    () => ({
      anchor: Math.max(0, Math.min(selectionState.anchor, value.length)),
      focus: Math.max(0, Math.min(selectionState.focus, value.length)),
    }),
    [selectionState, value.length],
  );
  const caret = selection.focus;

  const { segments, validation } = React.useMemo(
    () => segmentWithErrors(value),
    [value],
  );
  const target = React.useMemo(() => caretTarget(value, caret), [value, caret]);
  const context = React.useMemo<SearchContext>(
    () => ({
      caret,
      selection,
      target,
      ast: validation.ast,
      error: validation.error,
      segments,
      valid:
        validation.error === null && !segments.some((segment) => segment.error),
    }),
    [caret, segments, selection, target, validation.ast, validation.error],
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

  const setSelection = React.useCallback((next: EditorSelection) => {
    setSelectionState((current) =>
      current.anchor === next.anchor && current.focus === next.focus
        ? current
        : { anchor: next.anchor, focus: next.focus },
    );
  }, []);

  const setCaret = React.useCallback(
    (next: number) => setSelection(collapsed(next)),
    [setSelection],
  );

  const commit = React.useCallback(
    (
      nextValue: string,
      nextSelection: number | EditorSelection,
      options?: CommitOptions,
    ): SearchMutation => {
      const resolved =
        typeof nextSelection === "number"
          ? collapsed(nextSelection)
          : nextSelection;
      const nextContext = createSearchContext(nextValue, resolved);
      pendingSelectionRef.current = resolved;
      setSelectionState(resolved);
      recordedRef.current = nextValue;
      if (options?.history !== "skip") {
        history.record(
          { value: nextValue, selection: resolved },
          options?.history ?? "push",
        );
      }
      onValueChange(nextValue, nextContext);
      return {
        value: nextValue,
        caret: resolved.focus,
        selection: resolved,
        context: nextContext,
      };
    },
    [history, onValueChange],
  );

  // A value replaced from outside — a reset button, a saved search — is a state
  // worth returning to, so it joins the stack too.
  //
  // Only values this controller did not commit itself get here. Recording its
  // own commits again would be worse than redundant: `commit` records
  // synchronously while this effect runs a render later, so an effect carrying
  // a value the commit path has already superseded would push that stale value
  // as a new state and split the run of coalesced edits it belongs to.
  //
  // That lag needs React's real interleaving to appear, so jsdom cannot see it.
  // The `history` step of the browser harness is what covers this.
  React.useEffect(() => {
    if (value === recordedRef.current) return;
    recordedRef.current = value;
    history.record({ value, selection: collapsed(value.length) });
  }, [history, value]);

  const accept = React.useCallback(
    (item: SuggestionItem) => {
      if (item.disabled) return null;
      const { end } = ordered(selection);
      const head = value.slice(0, target.replaceFrom);
      const tail = value.slice(Math.max(end, target.replaceFrom));
      return commit(
        `${head}${item.insert}${tail}`,
        target.replaceFrom + item.insert.length,
      );
    },
    [commit, selection, target.replaceFrom, value],
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

  const undo = React.useCallback(() => {
    const entry = history.undo();
    if (!entry) return null;
    return commit(entry.value, entry.selection, { history: "skip" });
  }, [commit, history]);

  const redo = React.useCallback(() => {
    const entry = history.redo();
    if (!entry) return null;
    return commit(entry.value, entry.selection, { history: "skip" });
  }, [commit, history]);

  return {
    caret,
    selection,
    context,
    segments,
    items,
    validation,
    activeIndex,
    setActiveIndex,
    setCaret,
    setSelection,
    commit,
    accept,
    removeSegment,
    undo,
    redo,
    pendingSelectionRef,
  };
}

export type { EditorSelection } from "./selection";
