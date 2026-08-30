import * as React from "react";

export interface SuggestionItem {
  /** Shown on the left. */
  label: string;
  /** Shown on the right, muted — a value count, a type, a hint. */
  detail?: string;
  /** Text spliced into the query when the item is accepted. */
  insert: string;
}

export interface SuggestionsProps {
  items: SuggestionItem[];
  activeIndex: number;
  header?: string;
  /** Appended to `fs-suggestions`, for styling without the bundled theme. */
  className?: string;
  onSelect: (item: SuggestionItem, index: number) => void;
  onActiveIndexChange: (index: number) => void;
}

/**
 * The suggestion list. Presentational: it owns no query state and decides
 * nothing about what to offer — `SearchInput` derives that from the caret.
 *
 * Uses `onMouseDown` with `preventDefault` so clicking an item never steals
 * focus from the input, which would close the list before the click lands.
 */
export function Suggestions({
  items,
  activeIndex,
  header,
  className,
  onSelect,
  onActiveIndexChange,
}: SuggestionsProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={className ? `fs-suggestions ${className}` : "fs-suggestions"}
      role="listbox"
      aria-label={header}
    >
      {header && <div className="fs-suggestions-header">{header}</div>}
      {items.map((item, index) => (
        <button
          key={`${item.insert}-${index}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          data-active={index === activeIndex || undefined}
          className="fs-suggestion"
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onSelect(item, index)}
        >
          <span>{item.label}</span>
          {item.detail && (
            <span className="fs-suggestion-detail">{item.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}
