// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchInput, type SearchInputProps } from "./SearchInput";

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
            setValue(next);
            props.onValueChange?.(next, context);
          }}
        />
      );
    }

    act(() => root.render(<Harness />));
    return {
      changes,
      input: container.querySelector("input") as HTMLInputElement,
    };
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
    const { input, changes } = renderControlled({
      fields: [{ field: "kind" }],
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

  it("associates parse errors with the input", () => {
    const { input } = renderControlled({ value: "kind:" });
    const error = container.querySelector('[role="alert"]');

    expect(error).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("renders an accessible removal control for every chip", () => {
    renderControlled({ value: "kind:fruit colors:green" });
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[data-slot="remove"]',
    );

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Remove kind:fruit");
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
