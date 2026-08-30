// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SearchInput,
  type SearchContext,
  type SearchInputProps,
} from "./SearchInput";

vi.mock("@radix-ui/react-popover", async () => {
  const React = await import("react");
  const OpenContext = React.createContext(false);
  return {
    Root: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => <OpenContext.Provider value={open}>{children}</OpenContext.Provider>,
    Anchor: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Content: React.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        side?: string;
        align?: string;
        sideOffset?: number;
        onOpenAutoFocus?: unknown;
        onCloseAutoFocus?: unknown;
      }
    >(function Content(
      {
        children,
        side: _side,
        align: _align,
        sideOffset: _sideOffset,
        onOpenAutoFocus: _onOpenAutoFocus,
        onCloseAutoFocus: _onCloseAutoFocus,
        ...props
      },
      ref,
    ) {
      return React.useContext(OpenContext) ? (
        <div {...props} ref={ref}>
          {children}
        </div>
      ) : null;
    }),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

describe("SearchInput", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderControlled(
    props: Partial<SearchInputProps> = {},
    ref?: React.Ref<HTMLInputElement>,
  ) {
    const changes: string[] = [];
    const contexts: SearchContext[] = [];

    function Harness() {
      const [value, setValue] = React.useState(props.value ?? "");
      return (
        <SearchInput
          aria-label="Query"
          {...props}
          ref={ref}
          value={value}
          onValueChange={(next, context) => {
            changes.push(next);
            contexts.push(context);
            setValue(next);
            props.onValueChange?.(next, context);
          }}
        />
      );
    }

    act(() => root.render(<Harness />));
    return {
      changes,
      contexts,
      input: container.querySelector("input") as HTMLInputElement,
    };
  }

  function changeValue(
    input: HTMLInputElement,
    value: string,
    caret = value.length,
  ) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function hoverFirstChip(input: HTMLInputElement) {
    act(() => {
      input.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 0,
          clientY: 0,
        }),
      );
    });
  }

  it("forwards its input ref and native attributes", () => {
    const ref = React.createRef<HTMLInputElement>();
    const { input } = renderControlled(
      { name: "query", required: true, inputMode: "search" },
      ref,
    );

    expect(ref.current).toBe(input);
    expect(input.name).toBe("query");
    expect(input.required).toBe(true);
    expect(input.inputMode).toBe("search");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(
      container.querySelector('[data-slot="highlight-layer"]'),
    ).not.toBeNull();
  });

  it("uses an accessible combobox/listbox relationship", () => {
    const { input } = renderControlled({
      fields: [{ field: "kind", detail: "text" }],
    });

    act(() => input.focus());

    const listbox = container.querySelector('[role="listbox"]');
    const option = container.querySelector('[role="option"]');
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(option?.id);
    expect(option?.getAttribute("aria-selected")).toBe("true");
  });

  it("does not hijack Tab unless requested", () => {
    const { input, changes } = renderControlled({
      fields: [{ field: "kind" }],
    });
    act(() => input.focus());

    const allowed = input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(allowed).toBe(true);
    expect(changes).toEqual([]);
  });

  it("accepts the active suggestion with Enter", () => {
    const onSearch = vi.fn();
    const { input, changes } = renderControlled({
      fields: [{ field: "kind" }],
      onSearch,
    });
    act(() => input.focus());

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(changes).toEqual(["kind:"]);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("adds a space and searches when a value suggestion completes a chip", () => {
    const onSearch = vi.fn();
    const { input, changes } = renderControlled({
      value: "kind:f",
      fields: [{ field: "kind", values: ["fruit"] }],
      onSearch,
    });
    act(() => input.focus());

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(changes).toEqual(["kind:fruit "]);
    expect(onSearch).toHaveBeenCalledWith(
      "kind:fruit ",
      expect.objectContaining({ valid: true }),
    );
  });

  it("keeps ordinary value changes as drafts", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: "kind:f", onSearch });

    changeValue(input, "kind:fr");

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches when whitespace completes a valid chip", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: "kind:fruit", onSearch });

    changeValue(input, "kind:fruit ");

    expect(onSearch).toHaveBeenCalledWith(
      "kind:fruit ",
      expect.objectContaining({ valid: true }),
    );
  });

  it("does not treat whitespace inside a quoted value as chip completion", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: 'name:"granny"', onSearch });
    const next = 'name:"granny "';

    changeValue(input, next, next.length - 1);

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches when stepping over an auto-inserted closer completes a chip", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: 'name:"fruit"', onSearch });
    input.setSelectionRange('name:"fruit'.length, 'name:"fruit'.length);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: '"',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onSearch).toHaveBeenCalledWith(
      'name:"fruit"',
      expect.objectContaining({ valid: true }),
    );
  });

  it("normalizes lowercase boolean operators after a separator completes them", () => {
    const onSearch = vi.fn();
    const { input, changes, contexts } = renderControlled({
      value: "kind:fruit an",
      onSearch,
    });

    changeValue(input, "kind:fruit and");
    changeValue(input, "kind:fruit and ");

    expect(changes).toEqual(["kind:fruit and", "kind:fruit AND "]);
    expect(contexts.at(-1)?.valid).toBe(false);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not normalize an operator prefix while a field is being typed", () => {
    const { input, changes } = renderControlled();

    changeValue(input, "or");
    changeValue(input, "ori");
    changeValue(input, "origin:");

    expect(changes).toEqual(["or", "ori", "origin:"]);
  });

  it("dismisses on Escape and reopens when typing resumes", () => {
    const { input } = renderControlled({
      fields: [{ field: "kind" }],
    });
    act(() => input.focus());
    expect(input.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(input.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "k");
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not submit while an IME composition is active", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ onSearch });

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not search an incomplete field value", () => {
    const onSearch = vi.fn();
    const onContextChange = vi.fn();
    const { input } = renderControlled({
      value: "kind:",
      onSearch,
      onContextChange,
    });

    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      input.blur();
    });

    expect(onContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ valid: false, ast: null }),
    );
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches a valid query on Enter and blur", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: "kind:fruit", onSearch });

    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      input.blur();
    });

    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith(
      "kind:fruit",
      expect.objectContaining({ valid: true }),
    );
  });

  it("does not treat focus moving to a remove control as leaving the component", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({ value: "kind:fruit", onSearch });
    hoverFirstChip(input);
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove kind:fruit"]',
    );

    act(() => {
      input.focus();
      remove?.focus();
    });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("associates parse errors with the input", () => {
    const { input } = renderControlled({ value: "kind:" });
    const error = container.querySelector('[role="alert"]');

    expect(error).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("renders one accessible removal control for the active chip", () => {
    const { input } = renderControlled({
      value: "kind:fruit colors:green",
    });
    expect(container.querySelector('[data-slot="remove"]')).toBeNull();

    hoverFirstChip(input);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[data-slot="remove"]',
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Remove kind:fruit");
  });

  it("searches the remaining valid query after chip removal", () => {
    const onSearch = vi.fn();
    const { input } = renderControlled({
      value: "kind:fruit colors:green",
      onSearch,
    });
    hoverFirstChip(input);
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove kind:fruit"]',
    );

    act(() => remove?.click());

    expect(onSearch).toHaveBeenCalledWith(
      "colors:green",
      expect.objectContaining({ valid: true }),
    );
  });

  it("reports caret-only context changes", () => {
    const onContextChange = vi.fn();
    const { input } = renderControlled({
      value: "kind:fruit",
      onContextChange,
    });
    onContextChange.mockClear();

    act(() => {
      input.focus();
      input.setSelectionRange(2, 2);
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ caret: 2 }),
    );
  });
});
