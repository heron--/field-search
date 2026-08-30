import * as React from "react";
import type { SuggestionItem } from "./useFieldSearch";

export interface SuggestionClassNames {
  header?: string;
  item?: string;
  label?: string;
  detail?: string;
  status?: string;
}

export interface SuggestionsProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  items: SuggestionItem[];
  activeIndex: number;
  header?: React.ReactNode;
  loading?: boolean;
  loadingMessage?: React.ReactNode;
  emptyMessage?: React.ReactNode;
  classNames?: SuggestionClassNames;
  getItemId?: (item: SuggestionItem, index: number) => string;
  renderItem?: (
    item: SuggestionItem,
    state: { index: number; active: boolean },
  ) => React.ReactNode;
  onSelect: (item: SuggestionItem, index: number) => void;
  onActiveIndexChange: (index: number) => void;
}

function join(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

/** A presentational, controlled listbox for field-search suggestions. */
export const Suggestions = React.forwardRef<HTMLDivElement, SuggestionsProps>(
  function Suggestions(
    {
      items,
      activeIndex,
      header,
      loading = false,
      loadingMessage = "Loading suggestions…",
      emptyMessage,
      className,
      classNames = {},
      getItemId,
      renderItem,
      onSelect,
      onActiveIndexChange,
      id,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref,
  ) {
    const headerId = header && id ? `${id}-header` : undefined;
    const status = loading
      ? loadingMessage
      : items.length === 0
        ? emptyMessage
        : null;
    if (items.length === 0 && status == null) return null;

    return (
      <div
        {...props}
        ref={ref}
        className={join("fs-suggestions", className)}
        data-slot="suggestions"
      >
        {header && (
          <div
            id={headerId}
            className={join("fs-suggestions-header", classNames.header)}
            data-slot="suggestions-header"
          >
            {header}
          </div>
        )}

        {status != null && (
          <div
            className={join("fs-suggestions-status", classNames.status)}
            data-slot="suggestions-status"
            role="status"
          >
            {status}
          </div>
        )}

        <div
          id={id}
          role="listbox"
          data-slot="listbox"
          aria-busy={loading || undefined}
          aria-label={
            ariaLabel ?? (typeof header === "string" ? header : undefined)
          }
          aria-labelledby={ariaLabelledBy ?? headerId}
        >
          {!loading &&
            items.map((item, index) => {
              const active = index === activeIndex;
              return (
                <div
                  id={getItemId?.(item, index)}
                  key={item.id ?? `${item.insert}-${index}`}
                  role="option"
                  aria-selected={active}
                  aria-disabled={item.disabled || undefined}
                  data-active={active || undefined}
                  data-disabled={item.disabled || undefined}
                  data-slot="suggestion"
                  className={join("fs-suggestion", classNames.item)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!item.disabled) onActiveIndexChange(index);
                  }}
                  onClick={() => {
                    if (!item.disabled) onSelect(item, index);
                  }}
                >
                  {renderItem ? (
                    renderItem(item, { index, active })
                  ) : (
                    <>
                      <span
                        className={classNames.label}
                        data-slot="suggestion-label"
                      >
                        {item.label}
                      </span>
                      {item.detail != null && (
                        <span
                          className={join(
                            "fs-suggestion-detail",
                            classNames.detail,
                          )}
                          data-slot="suggestion-detail"
                        >
                          {item.detail}
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    );
  },
);

export type { SuggestionItem } from "./useFieldSearch";
