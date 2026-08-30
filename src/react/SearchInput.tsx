import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import type { ParseError } from "../parser";
import { Chip, type ChipClassNames } from "./Chip";
import { Suggestions, type SuggestionClassNames } from "./Suggestions";
import { normalizeOperators, type Segment } from "./segments";
import {
  useFieldSearch,
  type FieldSuggestion,
  type SearchContext,
  type SuggestionItem,
} from "./useFieldSearch";

export interface SearchInputClassNames {
  root?: string;
  field?: string;
  layer?: string;
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
  layer?: React.ElementType;
  error?: React.ElementType;
}

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "children" | "className" | "defaultValue" | "onChange" | "style" | "value"
> {
  /** Controlled query string. */
  value: string;
  onValueChange: (value: string, context: SearchContext) => void;
  onSearch?: (value: string, context: SearchContext) => void;
  /** Called for caret-only changes too, making async suggestions possible. */
  onContextChange?: (context: SearchContext) => void;
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
  renderChip?: (
    segment: Segment,
    state: { index: number; hovered: boolean; invalid: boolean },
  ) => React.ReactNode;
  /** Whether Tab accepts the active suggestion. Defaults to normal Tab behavior. */
  acceptOnTab?: boolean;
  /** Commit a valid draft when the input loses focus. Defaults to true. */
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
const DEFAULT_GEOMETRY = { spread: 3, closeWidth: 12 };
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

interface Measured {
  index: number;
  inlineStart: number;
  top: number;
  height: number;
}

function join(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

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

/** A styled convenience component built on the headless `useFieldSearch` API. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onValueChange,
      onSearch,
      onContextChange,
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
      disabled,
      readOnly,
      onFocus,
      onBlur,
      onKeyDown,
      onKeyUp,
      onClick,
      onSelect,
      onScroll,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...inputProps
    },
    forwardedRef,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const layerRef = React.useRef<HTMLDivElement>(null);
    const fieldRef = React.useRef<HTMLDivElement>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const chipRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
    const geometry = React.useRef(DEFAULT_GEOMETRY);
    const [inputFocused, setInputFocused] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [measurements, setMeasurements] = React.useState<Measured[]>([]);

    const controller = useFieldSearch({
      value,
      onValueChange,
      fields,
      suggestions,
      onContextChange,
    });

    const generatedId = React.useId().replaceAll(":", "");
    const inputId = suppliedId ?? `field-search-${generatedId}`;
    const listboxId = `${inputId}-suggestions`;
    const errorId = `${inputId}-error`;
    const activeItem = controller.items[controller.activeIndex];
    const activeItemId = activeItem
      ? `${listboxId}-option-${controller.activeIndex}`
      : undefined;

    const hasSuggestionContent =
      controller.items.length > 0 || suggestionsLoading || emptyMessage != null;
    const open =
      inputFocused && !disabled && !dismissed && hasSuggestionContent;
    const revealErrors = !inputFocused;
    const invalid =
      revealErrors && controller.segments.some((segment) => segment.error);

    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    useIsomorphicLayoutEffect(() => {
      const position = controller.pendingCaretRef.current;
      if (position === null) return;
      controller.pendingCaretRef.current = null;
      inputRef.current?.setSelectionRange(position, position);
    });

    const measureChips = React.useCallback(() => {
      const field = fieldRef.current;
      if (!field) return;
      const bounds = field.getBoundingClientRect();
      const direction = getComputedStyle(field).direction;
      const { spread } = geometry.current;
      const next: Measured[] = [];

      for (let index = 0; index < chipRefs.current.length; index++) {
        const node = chipRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        next.push({
          index,
          inlineStart:
            direction === "rtl"
              ? bounds.right - rect.left + spread
              : rect.right - bounds.left + spread,
          top: rect.top - bounds.top - spread,
          height: rect.height + spread * 2,
        });
      }
      setMeasurements(next);
    }, []);

    useIsomorphicLayoutEffect(() => {
      geometry.current = readGeometry(rootRef.current);
      measureChips();
      const field = fieldRef.current;
      if (!field || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measureChips);
      observer.observe(field);
      for (const chip of chipRefs.current) if (chip) observer.observe(chip);
      return () => observer.disconnect();
    }, [measureChips, value]);

    const syncCaret = React.useCallback(() => {
      controller.setCaret(inputRef.current?.selectionStart ?? 0);
    }, [controller]);

    const handleMouseMove = (event: React.MouseEvent) => {
      const field = fieldRef.current;
      if (!field) return;
      const direction = getComputedStyle(field).direction;
      const { clientX, clientY } = event;
      const { spread, closeWidth } = geometry.current;

      for (let index = 0; index < chipRefs.current.length; index++) {
        const node = chipRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const start =
          direction === "rtl"
            ? rect.left - spread - closeWidth
            : rect.left - spread;
        const end =
          direction === "rtl"
            ? rect.right + spread
            : rect.right + spread + closeWidth;
        if (
          clientX >= start &&
          clientX <= end &&
          clientY >= rect.top - spread &&
          clientY <= rect.bottom + spread
        ) {
          setHoveredIndex(index);
          return;
        }
      }
      setHoveredIndex(null);
    };

    const syncScroll = (event: React.UIEvent<HTMLInputElement>) => {
      const layer = layerRef.current;
      if (layer) layer.scrollLeft = event.currentTarget.scrollLeft;
      measureChips();
      onScroll?.(event);
    };

    const choose = (item: SuggestionItem, index: number) => {
      if (readOnly || disabled) return;
      const mutation = controller.accept(item);
      setDismissed(false);
      onSuggestionSelect?.(item, index);
      if (searchOnChipComplete && mutation?.context.valid) {
        onSearch?.(mutation.value, mutation.context);
      }
    };

    const remove = (segment: Segment, index: number) => {
      if (readOnly || disabled) return;
      const mutation = controller.removeSegment(index);
      setHoveredIndex(null);
      onSegmentRemove?.(segment, index);
      if (searchOnRemove && mutation?.context.valid) {
        onSearch?.(mutation.value, mutation.context);
      }
      inputRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
      if (readOnly || disabled) return;

      const start = event.currentTarget.selectionStart ?? 0;
      const end = event.currentTarget.selectionEnd ?? start;
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
        controller.commit(
          `${value.slice(0, start)}${event.key}${closer}${value.slice(start)}`,
          start + 1,
        );
      }
    };

    const Root = slots.root ?? "div";
    const Field = slots.field ?? "div";
    const Layer = slots.layer ?? "div";
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
          [className, classNames.root, rootProps?.className]
            .filter(Boolean)
            .join(" ") || undefined,
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
              ref={fieldRef}
              className={join("fs-field", classNames.field)}
              data-slot="field"
              data-invalid={invalid || undefined}
              data-disabled={disabled || undefined}
              onMouseEnter={() => {
                geometry.current = readGeometry(rootRef.current);
                measureChips();
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <Layer
                ref={layerRef}
                className={join("fs-layer", classNames.layer)}
                data-slot="highlight-layer"
                aria-hidden="true"
              >
                {controller.segments.map((segment, index) => {
                  if (segment.kind === "chip") {
                    const hovered = hoveredIndex === index;
                    return (
                      <Chip
                        key={`${segment.start}-${segment.text}`}
                        ref={(node) => {
                          chipRefs.current[index] = node;
                        }}
                        segment={segment}
                        hovered={hovered}
                        showError={revealErrors}
                        className={classNames.chip}
                        classNames={chipClassNames}
                      >
                        {renderChip?.(segment, {
                          index,
                          hovered,
                          invalid: Boolean(revealErrors && segment.error),
                        })}
                      </Chip>
                    );
                  }
                  chipRefs.current[index] = null;
                  const segmentClassName =
                    segment.kind === "operator"
                      ? join("fs-operator", classNames.operator)
                      : segment.kind === "paren"
                        ? join("fs-top-paren", classNames.paren)
                        : undefined;
                  return (
                    <span
                      key={`${segment.start}-${segment.kind}`}
                      className={segmentClassName}
                      data-slot={segment.kind}
                    >
                      {segment.text}
                    </span>
                  );
                })}
              </Layer>

              <input
                {...inputProps}
                ref={setInputRef}
                id={inputId}
                dir={dir}
                className={join("fs-native", classNames.input)}
                data-slot="input"
                type="text"
                spellCheck={inputProps.spellCheck ?? false}
                autoComplete={inputProps.autoComplete ?? "off"}
                disabled={disabled}
                readOnly={readOnly}
                value={value}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-activedescendant={open ? activeItemId : undefined}
                aria-invalid={ariaInvalid ?? (invalid || undefined)}
                aria-describedby={describedBy || undefined}
                onChange={(event) => {
                  const rawValue = event.currentTarget.value;
                  const nextValue = normalizeOperators(rawValue);
                  const position =
                    event.currentTarget.selectionStart ?? rawValue.length;
                  setDismissed(false);
                  const mutation = controller.commit(nextValue, position);
                  if (
                    searchOnChipComplete &&
                    mutation.context.valid &&
                    endsWithNewSeparator(
                      value,
                      nextValue,
                      position,
                      mutation.context,
                    )
                  ) {
                    onSearch?.(mutation.value, mutation.context);
                  }
                }}
                onKeyDown={handleKeyDown}
                onKeyUp={(event) => {
                  syncCaret();
                  onKeyUp?.(event);
                }}
                onClick={(event) => {
                  setDismissed(false);
                  syncCaret();
                  onClick?.(event);
                }}
                onSelect={(event) => {
                  syncCaret();
                  onSelect?.(event);
                }}
                onScroll={syncScroll}
                onFocus={(event) => {
                  setInputFocused(true);
                  setDismissed(false);
                  syncCaret();
                  onFocus?.(event);
                }}
                onBlur={(event) => {
                  setInputFocused(false);
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
              />

              {measurements.map((measurement) => {
                const segment = controller.segments[measurement.index];
                if (!segment || segment.kind !== "chip") return null;
                return (
                  <button
                    key={`remove-${segment.start}-${segment.text}`}
                    type="button"
                    className={join("fs-close", classNames.close)}
                    data-slot="remove"
                    data-visible={
                      hoveredIndex === measurement.index || undefined
                    }
                    data-negated={segment.negated || undefined}
                    style={{
                      insetInlineStart: measurement.inlineStart,
                      top: measurement.top,
                      height: measurement.height,
                    }}
                    disabled={disabled || readOnly}
                    aria-label={`Remove ${segment.text}`}
                    onFocus={() => setHoveredIndex(measurement.index)}
                    onBlur={() => setHoveredIndex(null)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => remove(segment, measurement.index)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                );
              })}
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
              [classNames.error, errorProps?.className]
                .filter(Boolean)
                .join(" ") || undefined,
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
  FieldSuggestion,
  SearchContext,
  SuggestionItem,
} from "./useFieldSearch";
