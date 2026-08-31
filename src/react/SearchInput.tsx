import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import type { ParseError } from "../parser";
import { Chip, type ChipClassNames } from "./Chip";
import { DEV } from "./dev";
import { Suggestions, type SuggestionClassNames } from "./Suggestions";
import { normalizeOperators, type Segment } from "./segments";
import {
  applySelection,
  ordered,
  readSelection,
  readText,
  stepBack,
  stepForward,
  toModelRange,
  wordBack,
  wordForward,
  type EditorSelection,
} from "./selection";
import {
  createSearchContext,
  useFieldSearch,
  type FieldSuggestion,
  type SearchContext,
  type SuggestionItem,
} from "./useFieldSearch";

export interface SearchInputClassNames {
  root?: string;
  field?: string;
  /** The editable element. */
  editor?: string;
  /** @deprecated Renamed to `editor`. Still applied to the editable element. */
  input?: string;
  chip?: string;
  close?: string;
  operator?: string;
  paren?: string;
  popover?: string;
  suggestions?: string;
  error?: string;
}

export interface SearchInputSlots {
  root?: React.ElementType;
  field?: React.ElementType;
  error?: React.ElementType;
}

export interface SearchInputProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  | "children"
  | "className"
  | "contentEditable"
  | "dangerouslySetInnerHTML"
  | "defaultValue"
  | "onChange"
  | "onSelect"
  | "style"
  | "suppressContentEditableWarning"
> {
  /** Controlled query string. */
  value: string;
  onValueChange: (value: string, context: SearchContext) => void;
  onSearch?: (value: string, context: SearchContext) => void;
  /** Called for caret-only changes too, making async suggestions possible. */
  onContextChange?: (context: SearchContext) => void;
  /** Muted text shown while the query is empty. */
  placeholder?: string;
  /** Mirrored into a hidden input so the query submits with a surrounding form. */
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** Sets `aria-required`. A query cannot take part in native validation. */
  required?: boolean;
  fields?: FieldSuggestion[];
  /** Controlled suggestions. Overrides the built-in `fields` matcher. */
  suggestions?: SuggestionItem[];
  suggestionsHeader?:
    React.ReactNode | ((context: SearchContext) => React.ReactNode);
  suggestionsLoading?: boolean;
  loadingMessage?: React.ReactNode;
  emptyMessage?: React.ReactNode;
  onSuggestionSelect?: (item: SuggestionItem, index: number) => void;
  onSegmentRemove?: (segment: Segment, index: number) => void;
  renderSuggestion?: (
    item: SuggestionItem,
    state: { index: number; active: boolean },
  ) => React.ReactNode;
  /**
   * Replaces the contents of a chip.
   *
   * The chip's text is now the query text the caret moves through, so whatever
   * this returns must render exactly `segment.text` — decorate it, split it,
   * re-colour it, but do not add or drop characters. A development-only check
   * reports drift.
   */
  renderChip?: (
    segment: Segment,
    state: { index: number; hovered: boolean; invalid: boolean },
  ) => React.ReactNode;
  /** Whether Tab accepts the active suggestion. Defaults to normal Tab behavior. */
  acceptOnTab?: boolean;
  /** Commit a valid draft when the field loses focus. Defaults to true. */
  searchOnBlur?: boolean;
  /** Commit when a valid chip is completed. Defaults to true. */
  searchOnChipComplete?: boolean;
  /** Commit the remaining valid query after chip removal. Defaults to true. */
  searchOnRemove?: boolean;
  showError?: boolean;
  renderError?: (error: ParseError) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  classNames?: SearchInputClassNames;
  chipClassNames?: ChipClassNames;
  suggestionClassNames?: SuggestionClassNames;
  slots?: SearchInputSlots;
  rootProps?: Omit<React.HTMLAttributes<HTMLDivElement>, "children">;
  errorProps?: Omit<React.HTMLAttributes<HTMLDivElement>, "children">;
  popoverProps?: Omit<
    React.ComponentPropsWithoutRef<typeof Popover.Content>,
    "children" | "className"
  >;
  /** Portal destination. Defaults to the root so scoped theme tokens inherit. */
  portalContainer?: HTMLElement | null;
}

const PAIRS: Record<string, string> = { '"': '"', "(": ")", "[": "]" };
const CLOSERS: Record<string, true> = { '"': true, ")": true, "]": true };
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function join(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

function classes(...values: (string | undefined)[]) {
  return values.filter(Boolean).join(" ") || undefined;
}

/**
 * `plaintext-only` stops the browser inserting markup of its own. Where it is
 * unsupported the attribute would fall back to "inherit" and leave the field
 * uneditable, so it is applied after mount rather than rendered outright.
 */
let plaintextOnlySupport: boolean | null = null;
function supportsPlaintextOnly() {
  if (plaintextOnlySupport !== null) return plaintextOnlySupport;
  if (typeof document === "undefined") return false;
  const probe = document.createElement("div");
  probe.setAttribute("contenteditable", "plaintext-only");
  plaintextOnlySupport = probe.contentEditable === "plaintext-only";
  return plaintextOnlySupport;
}

function nextEnabledIndex(
  items: SuggestionItem[],
  current: number,
  direction: 1 | -1,
) {
  if (items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset++) {
    const index = (current + direction * offset + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

/**
 * What a delete should remove when the browser did not say.
 *
 * Chrome and Safari attach an explicit target range to `beforeinput`, which
 * already accounts for grapheme clusters and each platform's word rules. This
 * is the fallback for engines that report a collapsed range instead.
 */
function deletionRange(
  value: string,
  selection: EditorSelection,
  inputType: string,
): EditorSelection {
  const { start, end } = ordered(selection);
  if (start !== end) return { anchor: start, focus: end };

  switch (inputType) {
    case "deleteWordBackward":
      return { anchor: wordBack(value, start), focus: start };
    case "deleteWordForward":
      return { anchor: start, focus: wordForward(value, start) };
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
    case "deleteToBeginningOfLine":
      return { anchor: 0, focus: start };
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
    case "deleteToEndOfLine":
      return { anchor: start, focus: value.length };
    case "deleteContentForward":
      return { anchor: start, focus: stepForward(value, start) };
    default:
      return { anchor: stepBack(value, start), focus: start };
  }
}

function endsWithNewSeparator(
  previousValue: string,
  nextValue: string,
  caret: number,
  context: SearchContext,
) {
  if (nextValue.length <= previousValue.length || caret <= 0) return false;
  const separator = nextValue[caret - 1];
  const before = nextValue[caret - 2];
  const segment = context.segments.find(
    (current) => caret - 1 >= current.start && caret - 1 < current.end,
  );
  return Boolean(
    segment?.kind === "space" &&
    separator &&
    /\s/.test(separator) &&
    before &&
    !/\s/.test(before),
  );
}

/**
 * Normalize completed operators while leaving the word at the caret alone.
 * A draft ending in `or` may still become `origin`; typing a separator makes
 * the operator unambiguous and allows `normalizeOperators` to uppercase it.
 */
function normalizeEditingOperators(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret);
  const activeOperator = beforeCaret.match(/(^|[\s(])(and|or)$/i)?.[2];
  if (!activeOperator) return normalizeOperators(value);

  const start = caret - activeOperator.length;
  const masked =
    value.slice(0, start) +
    "_".repeat(activeOperator.length) +
    value.slice(caret);
  const normalized = normalizeOperators(masked);
  return (
    normalized.slice(0, start) +
    value.slice(start, caret) +
    normalized.slice(caret)
  );
}

const CloseIcon = (
  <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path
      d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/** A styled convenience component built on the headless `useFieldSearch` API. */
export const SearchInput = React.forwardRef<HTMLDivElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onValueChange,
      onSearch,
      onContextChange,
      placeholder,
      name,
      disabled = false,
      readOnly = false,
      required = false,
      fields = [],
      suggestions,
      suggestionsHeader,
      suggestionsLoading = false,
      loadingMessage,
      emptyMessage,
      onSuggestionSelect,
      onSegmentRemove,
      renderSuggestion,
      renderChip,
      acceptOnTab = false,
      searchOnBlur = true,
      searchOnChipComplete = true,
      searchOnRemove = true,
      showError = true,
      renderError,
      className,
      style,
      classNames = {},
      chipClassNames,
      suggestionClassNames,
      slots = {},
      rootProps,
      errorProps,
      popoverProps,
      portalContainer,
      id: suppliedId,
      dir,
      tabIndex,
      spellCheck,
      onFocus,
      onBlur,
      onKeyDown,
      onKeyUp,
      onClick,
      onPointerDown,
      onPaste,
      onCut,
      onCompositionStart,
      onCompositionEnd,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...editorProps
    },
    forwardedRef,
  ) {
    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const composingRef = React.useRef(false);
    const [editorNode, setEditorNode] = React.useState<HTMLDivElement | null>(
      null,
    );
    const [focusedField, setFocusedField] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [plaintextOnly, setPlaintextOnly] = React.useState(false);

    const controller = useFieldSearch({
      value,
      onValueChange,
      fields,
      suggestions,
      onContextChange,
    });

    const editable = !disabled && !readOnly;
    const generatedId = React.useId().replaceAll(":", "");
    const editorId = suppliedId ?? `field-search-${generatedId}`;
    const listboxId = `${editorId}-suggestions`;
    const errorId = `${editorId}-error`;
    const activeItem = controller.items[controller.activeIndex];
    const activeItemId = activeItem
      ? `${listboxId}-option-${controller.activeIndex}`
      : undefined;

    const hasSuggestionContent =
      controller.items.length > 0 || suggestionsLoading || emptyMessage != null;
    const open =
      focusedField && !disabled && !dismissed && hasSuggestionContent;
    const revealErrors = !focusedField;
    const invalid =
      revealErrors && controller.segments.some((segment) => segment.error);

    const setEditorRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        editorRef.current = node;
        setEditorNode(node);
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const selectionNow = () =>
      readSelection(editorRef.current) ?? controller.selection;

    const syncSelection = () => {
      const next = readSelection(editorRef.current);
      if (next) controller.setSelection(next);
    };

    /* ---------------------------------------------------------------- */
    /* Editing                                                          */
    /* ---------------------------------------------------------------- */

    const applyEdit = (
      range: EditorSelection,
      insert: string,
      options?: { coalesce?: boolean },
    ) => {
      if (!editable) return null;
      const { start, end } = ordered(range);
      // The query is a single line, so anything multi-line becomes spaces.
      const text = insert.replace(/[\r\n\t]+/g, " ");
      if (start === end && text === "") return null;

      const caret = start + text.length;
      const nextValue = normalizeEditingOperators(
        value.slice(0, start) + text + value.slice(end),
        caret,
      );
      setDismissed(false);
      const mutation = controller.commit(nextValue, caret, {
        history: options?.coalesce ? "coalesce" : "push",
      });
      if (
        searchOnChipComplete &&
        mutation.context.valid &&
        endsWithNewSeparator(value, nextValue, caret, mutation.context)
      ) {
        onSearch?.(mutation.value, mutation.context);
      }
      return mutation;
    };

    /**
     * Every edit is intercepted and replayed against the model, so the browser
     * never mutates the field itself and React stays the only writer. The one
     * exception is composition, which cannot be cancelled; the model catches up
     * on `compositionend`.
     */
    const handleBeforeInput = (event: InputEvent) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (!editable) {
        event.preventDefault();
        return;
      }
      const type = event.inputType;
      if (
        composingRef.current ||
        event.isComposing ||
        type.startsWith("insertCompositionText")
      ) {
        return;
      }

      if (type === "historyUndo") {
        event.preventDefault();
        setDismissed(false);
        controller.undo();
        return;
      }
      if (type === "historyRedo") {
        event.preventDefault();
        setDismissed(false);
        controller.redo();
        return;
      }

      const ranges =
        typeof event.getTargetRanges === "function"
          ? event.getTargetRanges()
          : [];
      const supplied = ranges[0];
      const at = supplied
        ? toModelRange(editor, supplied)
        : (readSelection(editor) ?? controller.selection);

      if (type.startsWith("delete")) {
        event.preventDefault();
        applyEdit(deletionRange(value, at, type), "");
        return;
      }

      if (type === "insertText" || type === "insertReplacementText") {
        event.preventDefault();
        const text =
          event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
        applyEdit(at, text, {
          coalesce: text.length === 1 && !/\s/.test(text),
        });
        return;
      }

      // Line breaks, rich paste, drops and formatting mean nothing in a
      // single-line query. Paste and cut arrive through their own clipboard
      // events, which carry data more reliably than `dataTransfer` does here.
      event.preventDefault();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;

      if (open && event.key === "ArrowDown") {
        event.preventDefault();
        controller.setActiveIndex((index) =>
          nextEnabledIndex(controller.items, index, 1),
        );
        return;
      }
      if (open && event.key === "ArrowUp") {
        event.preventDefault();
        controller.setActiveIndex((index) =>
          nextEnabledIndex(controller.items, index, -1),
        );
        return;
      }
      if (
        open &&
        activeItem &&
        !activeItem.disabled &&
        (event.key === "Enter" || (acceptOnTab && event.key === "Tab"))
      ) {
        event.preventDefault();
        choose(activeItem, controller.activeIndex);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (controller.context.valid) onSearch?.(value, controller.context);
        return;
      }
      if (!editable) return;

      // The browser's own undo stack only holds edits the browser performed,
      // and it performs none, so history is driven from here.
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modified && !event.altKey && (key === "z" || key === "y")) {
        event.preventDefault();
        setDismissed(false);
        if (key === "y" || event.shiftKey) controller.redo();
        else controller.undo();
        return;
      }
      if (modified) return;

      const { start, end } = ordered(selectionNow());
      if (CLOSERS[event.key] && start === end && value[start] === event.key) {
        event.preventDefault();
        const mutation = controller.commit(value, start + 1);
        if (searchOnChipComplete && mutation.context.valid) {
          onSearch?.(mutation.value, mutation.context);
        }
        return;
      }
      const closer = PAIRS[event.key];
      if (closer && start === end) {
        event.preventDefault();
        const raw = `${value.slice(0, start)}${event.key}${closer}${value.slice(end)}`;
        controller.commit(normalizeEditingOperators(raw, start + 1), start + 1);
      }
    };

    const choose = (item: SuggestionItem, index: number) => {
      if (!editable) return;
      const target = controller.context.target;
      const { end } = ordered(controller.selection);
      const head = value.slice(0, target.replaceFrom);
      const tail = value.slice(Math.max(end, target.replaceFrom));
      const acceptedValue = `${head}${item.insert}${tail}`;
      const acceptedCaret = target.replaceFrom + item.insert.length;
      const completesFinalValue =
        item.insert.length > 0 &&
        !/\s$/.test(item.insert) &&
        tail.length === 0 &&
        createSearchContext(acceptedValue, acceptedCaret).valid;
      const acceptedItem = completesFinalValue
        ? { ...item, insert: `${item.insert} ` }
        : item;
      const mutation = controller.accept(acceptedItem);
      setDismissed(false);
      onSuggestionSelect?.(item, index);
      if (searchOnChipComplete && mutation?.context.valid) {
        onSearch?.(mutation.value, mutation.context);
      }
    };

    const remove = (segment: Segment, index: number) => {
      if (!editable) return;
      const mutation = controller.removeSegment(index);
      setHoveredIndex(null);
      onSegmentRemove?.(segment, index);
      if (searchOnRemove && mutation?.context.valid) {
        onSearch?.(mutation.value, mutation.context);
      }
      editorRef.current?.focus();
    };

    /* ---------------------------------------------------------------- */
    /* DOM wiring                                                       */
    /* ---------------------------------------------------------------- */

    const beforeInputRef = React.useRef(handleBeforeInput);
    useIsomorphicLayoutEffect(() => {
      beforeInputRef.current = handleBeforeInput;
    });

    // React's `onBeforeInput` is not the native event and carries no
    // `inputType` or target ranges, so the real one is bound by hand.
    React.useEffect(() => {
      if (!editorNode) return;
      const listener = (event: Event) =>
        beforeInputRef.current(event as InputEvent);
      editorNode.addEventListener("beforeinput", listener);
      return () => editorNode.removeEventListener("beforeinput", listener);
    }, [editorNode]);

    React.useEffect(() => {
      setPlaintextOnly(supportsPlaintextOnly());
    }, []);

    // Kept in step with the model so the listener below can recognise its own
    // writes without needing to be re-subscribed on every render.
    const selectionRef = React.useRef(controller.selection);
    useIsomorphicLayoutEffect(() => {
      selectionRef.current = controller.selection;
    });

    const setSelection = controller.setSelection;
    React.useEffect(() => {
      if (!editorNode) return;
      const document = editorNode.ownerDocument;
      const sync = () => {
        if (document.activeElement !== editorNode) return;
        if (composingRef.current) return;
        const next = readSelection(editorNode);
        if (!next) return;
        // Writing the selection ourselves fires this event too. A reading that
        // already matches the model is that echo, and acting on it would set
        // state, re-render, write the selection again, and never settle.
        const current = selectionRef.current;
        if (next.anchor === current.anchor && next.focus === current.focus) {
          return;
        }
        setSelection(next);
      };
      document.addEventListener("selectionchange", sync);
      return () => document.removeEventListener("selectionchange", sync);
    }, [editorNode, setSelection]);

    useIsomorphicLayoutEffect(() => {
      const pending = controller.pendingSelectionRef.current;
      if (pending === null) return;
      controller.pendingSelectionRef.current = null;
      const editor = editorRef.current;
      if (!editor) return;
      // Never pull the caret into a field nobody is editing.
      const active = editor.ownerDocument.activeElement;
      if (active !== editor && !editor.contains(active)) return;
      applySelection(editor, pending);
    });

    // The whole design rests on the rendered text being the query text.
    useIsomorphicLayoutEffect(() => {
      if (!DEV) return;
      const editor = editorRef.current;
      if (!editor || composingRef.current) return;
      const rendered = readText(editor);
      if (rendered === value) return;
      console.error(
        "field-search: the editable field renders %o but the query is %o. " +
          "Chip content must concatenate back to the segment text — check `renderChip`.",
        rendered,
        value,
      );
    });

    /* ---------------------------------------------------------------- */

    const Root = slots.root ?? "div";
    const Field = slots.field ?? "div";
    const ErrorSlot = slots.error ?? "div";
    const header =
      typeof suggestionsHeader === "function"
        ? suggestionsHeader(controller.context)
        : (suggestionsHeader ??
          (controller.context.target.kind === "value"
            ? `Values for ${controller.context.target.field}`
            : "Filter by"));
    const describedBy =
      showError && revealErrors && controller.validation.error
        ? [ariaDescribedBy, errorId].filter(Boolean).join(" ")
        : ariaDescribedBy;
    const {
      side = "bottom",
      align = "start",
      sideOffset = 6,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...contentProps
    } = popoverProps ?? {};

    return (
      <Root
        {...rootProps}
        ref={rootRef}
        className={join(
          "fs-root",
          classes(className, classNames.root, rootProps?.className),
        )}
        style={{ ...rootProps?.style, ...style }}
        dir={rootProps?.dir ?? dir}
        data-slot="root"
      >
        <Popover.Root
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDismissed(true);
          }}
        >
          <Popover.Anchor asChild>
            <Field
              className={join("fs-field", classNames.field)}
              data-slot="field"
              data-invalid={invalid || undefined}
              data-disabled={disabled || undefined}
            >
              <div
                {...editorProps}
                ref={setEditorRef}
                id={editorId}
                className={join(
                  "fs-editor",
                  classes(classNames.editor, classNames.input),
                )}
                data-slot="editor"
                contentEditable={
                  editable
                    ? plaintextOnly
                      ? "plaintext-only"
                      : true
                    : undefined
                }
                suppressContentEditableWarning
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-multiline={false}
                aria-controls={open ? listboxId : undefined}
                aria-activedescendant={open ? activeItemId : undefined}
                aria-invalid={ariaInvalid ?? (invalid || undefined)}
                aria-describedby={describedBy || undefined}
                aria-disabled={disabled || undefined}
                aria-readonly={readOnly || undefined}
                aria-required={required || undefined}
                data-placeholder={placeholder}
                data-empty={value === "" || undefined}
                dir={dir}
                spellCheck={spellCheck ?? false}
                tabIndex={disabled ? -1 : (tabIndex ?? 0)}
                onKeyDown={handleKeyDown}
                onKeyUp={(event) => {
                  syncSelection();
                  onKeyUp?.(event);
                }}
                onClick={(event) => {
                  setDismissed(false);
                  syncSelection();
                  onClick?.(event);
                }}
                onPointerDown={onPointerDown}
                onFocus={(event) => {
                  setFocusedField(true);
                  setDismissed(false);
                  syncSelection();
                  onFocus?.(event);
                }}
                onBlur={(event) => {
                  setFocusedField(false);
                  const nextFocus = event.relatedTarget;
                  const leftComponent =
                    !(nextFocus instanceof Node) ||
                    !rootRef.current?.contains(nextFocus);
                  if (
                    searchOnBlur &&
                    leftComponent &&
                    controller.context.valid
                  ) {
                    onSearch?.(value, controller.context);
                  }
                  onBlur?.(event);
                }}
                onCompositionStart={(event) => {
                  composingRef.current = true;
                  onCompositionStart?.(event);
                }}
                onCompositionEnd={(event) => {
                  composingRef.current = false;
                  const editor = editorRef.current;
                  if (editor && editable) {
                    const composed = readText(editor);
                    const at = readSelection(editor) ?? controller.selection;
                    if (composed === value) {
                      controller.setSelection(at);
                    } else {
                      setDismissed(false);
                      controller.commit(
                        normalizeEditingOperators(composed, at.focus),
                        at,
                      );
                    }
                  }
                  onCompositionEnd?.(event);
                }}
                onPaste={(event) => {
                  onPaste?.(event);
                  if (event.defaultPrevented || !editable) return;
                  event.preventDefault();
                  const text = event.clipboardData?.getData("text/plain") ?? "";
                  applyEdit(selectionNow(), text);
                }}
                onCut={(event) => {
                  onCut?.(event);
                  if (event.defaultPrevented || !editable) return;
                  event.preventDefault();
                  const { start, end } = ordered(selectionNow());
                  if (start === end) return;
                  event.clipboardData?.setData(
                    "text/plain",
                    value.slice(start, end),
                  );
                  applyEdit({ anchor: start, focus: end }, "");
                }}
              >
                {controller.segments.map((segment, index) => {
                  if (segment.kind === "chip") {
                    const hovered = hoveredIndex === index;
                    return (
                      <Chip
                        key={`${index}-chip`}
                        segment={segment}
                        hovered={hovered}
                        showError={revealErrors}
                        className={classNames.chip}
                        classNames={chipClassNames}
                        onMouseEnter={() => setHoveredIndex(index)}
                        onMouseLeave={() =>
                          setHoveredIndex((current) =>
                            current === index ? null : current,
                          )
                        }
                        end={
                          editable ? (
                            <button
                              type="button"
                              className={join("fs-close", classNames.close)}
                              data-slot="remove"
                              contentEditable={false}
                              aria-label={`Remove ${segment.text}`}
                              onKeyDown={(event) => {
                                if (event.key !== "Escape") return;
                                event.preventDefault();
                                editorRef.current?.focus();
                              }}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => remove(segment, index)}
                            >
                              {CloseIcon}
                            </button>
                          ) : undefined
                        }
                      >
                        {renderChip?.(segment, {
                          index,
                          hovered,
                          invalid: Boolean(revealErrors && segment.error),
                        })}
                      </Chip>
                    );
                  }

                  const segmentClassName =
                    segment.kind === "operator"
                      ? join("fs-operator", classNames.operator)
                      : segment.kind === "paren"
                        ? join("fs-top-paren", classNames.paren)
                        : undefined;
                  return (
                    <span
                      key={`${index}-${segment.kind}`}
                      className={segmentClassName}
                      data-slot={segment.kind}
                    >
                      {segment.text}
                    </span>
                  );
                })}
              </div>

              {name !== undefined && (
                <input type="hidden" name={name} value={value} />
              )}
            </Field>
          </Popover.Anchor>

          <Popover.Portal container={portalContainer ?? rootRef.current}>
            <Popover.Content
              {...contentProps}
              className={join("fs-suggestions-wrap", classNames.popover)}
              data-slot="popover"
              side={side}
              align={align}
              sideOffset={sideOffset}
              onOpenAutoFocus={(event) => {
                onOpenAutoFocus?.(event);
                if (!event.defaultPrevented) event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                onCloseAutoFocus?.(event);
                if (!event.defaultPrevented) event.preventDefault();
              }}
            >
              <Suggestions
                id={listboxId}
                items={controller.items}
                activeIndex={controller.activeIndex}
                className={classNames.suggestions}
                classNames={suggestionClassNames}
                header={header}
                loading={suggestionsLoading}
                loadingMessage={loadingMessage}
                emptyMessage={emptyMessage}
                getItemId={(_item, index) => `${listboxId}-option-${index}`}
                renderItem={renderSuggestion}
                onSelect={choose}
                onActiveIndexChange={controller.setActiveIndex}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {showError && revealErrors && controller.validation.error && (
          <ErrorSlot
            {...errorProps}
            id={errorId}
            className={join(
              "fs-error",
              classes(classNames.error, errorProps?.className),
            )}
            data-slot="error"
            role="alert"
          >
            {renderError?.(controller.validation.error) ??
              controller.validation.error.message}
          </ErrorSlot>
        )}
      </Root>
    );
  },
);

export type {
  EditorSelection,
  FieldSuggestion,
  SearchContext,
  SuggestionItem,
} from "./useFieldSearch";
