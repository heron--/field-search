// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySelection, readText } from "./selection";
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
    ref?: React.Ref<HTMLDivElement>,
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
    const editor = container.querySelector(
      '[data-slot="editor"]',
    ) as HTMLDivElement;
    act(() => editor.focus());
    return { changes, contexts, editor };
  }

  /** Move the caret, the way a click or an arrow key would. */
  function caretAt(editor: HTMLElement, offset: number, focus = offset) {
    act(() => {
      applySelection(editor, { anchor: offset, focus });
      editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    });
  }

  /** Dispatch the native `beforeinput` the component listens for. */
  function edit(
    editor: HTMLElement,
    inputType: string,
    data?: string,
    at?: { anchor: number; focus: number },
  ) {
    act(() => {
      if (at) applySelection(editor, at);
      editor.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data,
        }),
      );
    });
  }

  function type(
    editor: HTMLElement,
    text: string,
    at?: { anchor: number; focus: number },
  ) {
    for (const [index, character] of [...text].entries()) {
      edit(editor, "insertText", character, index === 0 ? at : undefined);
    }
  }

  function press(
    editor: HTMLElement,
    key: string,
    init: KeyboardEventInit = {},
  ) {
    let allowed = true;
    act(() => {
      allowed = editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
    return allowed;
  }

  it("forwards its ref to the editable element and passes attributes through", () => {
    const ref = React.createRef<HTMLDivElement>();
    const { editor } = renderControlled(
      { name: "query", required: true, inputMode: "search" },
      ref,
    );

    expect(ref.current).toBe(editor);
    expect(editor.getAttribute("role")).toBe("combobox");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.getAttribute("aria-multiline")).toBe("false");
    expect(editor.getAttribute("aria-required")).toBe("true");
    expect(editor.getAttribute("inputmode")).toBe("search");
    expect(
      container.querySelector<HTMLInputElement>('input[type="hidden"]')?.name,
    ).toBe("query");
  });

  it("shows the placeholder only while the query is empty", () => {
    const { editor } = renderControlled({ placeholder: "kind:fruit" });
    expect(editor.getAttribute("data-placeholder")).toBe("kind:fruit");
    expect(editor.hasAttribute("data-empty")).toBe(true);

    type(editor, "k");
    expect(editor.hasAttribute("data-empty")).toBe(false);
  });

  it("uses an accessible combobox/listbox relationship", () => {
    const { editor } = renderControlled({
      fields: [{ field: "kind", detail: "text" }],
    });

    const listbox = container.querySelector('[role="listbox"]');
    const option = container.querySelector('[role="option"]');
    expect(editor.getAttribute("aria-expanded")).toBe("true");
    expect(editor.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(editor.getAttribute("aria-activedescendant")).toBe(option?.id);
    expect(option?.getAttribute("aria-selected")).toBe("true");
  });

  /* ---------------------------------------------------------------- */
  /* The invariant the whole design rests on                          */
  /* ---------------------------------------------------------------- */

  it("renders exactly the query text, chips and all", () => {
    const { editor } = renderControlled({
      value: '(kind:fruit OR kind:veg) AND -name:"granny smith"',
    });

    expect(readText(editor)).toBe(
      '(kind:fruit OR kind:veg) AND -name:"granny smith"',
    );
  });

  it("keeps the rendered text and the query in step while typing", () => {
    const { editor } = renderControlled();

    type(editor, "kind:fruit -colors:green");

    expect(readText(editor)).toBe("kind:fruit -colors:green");
  });

  it("puts the remove control inside the chip, out of the text", () => {
    const { editor } = renderControlled({ value: "kind:fruit" });
    const remove = container.querySelector<HTMLButtonElement>(
      'button[data-slot="remove"]',
    )!;

    expect(editor.contains(remove)).toBe(true);
    expect(remove.getAttribute("contenteditable")).toBe("false");
    // The anchor wrapping it is the boundary offset mapping stops at.
    expect(remove.closest("[data-fs-nontext]")).not.toBeNull();
    expect(readText(editor)).toBe("kind:fruit");
  });

  /* ---------------------------------------------------------------- */
  /* Editing                                                          */
  /* ---------------------------------------------------------------- */

  it("inserts text at the caret", () => {
    const { editor, changes } = renderControlled({ value: "kind:fruit" });

    type(editor, "s", { anchor: 4, focus: 4 });

    expect(changes).toEqual(["kinds:fruit"]);
  });

  it("replaces the selected range", () => {
    const { editor, changes } = renderControlled({ value: "kind:fruit" });

    type(editor, "veg", { anchor: 5, focus: 10 });

    expect(changes.at(-1)).toBe("kind:veg");
  });

  it("deletes one grapheme cluster at a time", () => {
    const { editor, changes } = renderControlled({ value: "name:a👍🏽" });

    edit(editor, "deleteContentBackward", undefined, {
      anchor: "name:a👍🏽".length,
      focus: "name:a👍🏽".length,
    });

    expect(changes).toEqual(["name:a"]);
  });

  it("deletes a whole word backwards", () => {
    const { editor, changes } = renderControlled({ value: "kind:fruit apple" });

    edit(editor, "deleteWordBackward", undefined, { anchor: 16, focus: 16 });

    expect(changes).toEqual(["kind:fruit "]);
  });

  it("deletes forwards from the caret", () => {
    const { editor, changes } = renderControlled({ value: "kind:fruit" });

    edit(editor, "deleteContentForward", undefined, { anchor: 4, focus: 4 });

    expect(changes).toEqual(["kindfruit"]);
  });

  it("collapses a pasted multi-line value onto one line", () => {
    const { editor, changes } = renderControlled();

    act(() => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => "kind:fruit\ncolors:green" },
      });
      editor.dispatchEvent(event);
    });

    expect(changes).toEqual(["kind:fruit colors:green"]);
  });

  it("refuses line breaks and rich content", () => {
    const { editor, changes } = renderControlled({ value: "kind:fruit" });

    edit(editor, "insertParagraph");
    edit(editor, "insertLineBreak");
    edit(editor, "formatBold");

    expect(changes).toEqual([]);
    expect(readText(editor)).toBe("kind:fruit");
  });

  it("makes no edits when read-only", () => {
    const { editor, changes } = renderControlled({
      value: "kind:fruit",
      readOnly: true,
    });

    expect(editor.hasAttribute("contenteditable")).toBe(false);
    type(editor, "s", { anchor: 4, focus: 4 });
    expect(changes).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* History                                                          */
  /* ---------------------------------------------------------------- */

  it("undoes and redoes a run of typing as one step", () => {
    const { editor, changes } = renderControlled({ value: "kind:" });

    type(editor, "fruit", { anchor: 5, focus: 5 });
    expect(changes.at(-1)).toBe("kind:fruit");

    press(editor, "z", { metaKey: true });
    expect(changes.at(-1)).toBe("kind:");

    press(editor, "z", { metaKey: true, shiftKey: true });
    expect(changes.at(-1)).toBe("kind:fruit");
  });

  it("breaks undo steps at word boundaries", () => {
    const { editor, changes } = renderControlled();

    type(editor, "kind:fruit apple");
    press(editor, "z", { metaKey: true });

    expect(changes.at(-1)).toBe("kind:fruit ");
  });

  it("undoes through the native history input type too", () => {
    const { editor, changes } = renderControlled({ value: "kind:" });

    type(editor, "fruit", { anchor: 5, focus: 5 });
    edit(editor, "historyUndo");

    expect(changes.at(-1)).toBe("kind:");
  });

  /* ---------------------------------------------------------------- */
  /* Suggestions                                                      */
  /* ---------------------------------------------------------------- */

  it("does not hijack Tab unless requested", () => {
    const { editor, changes } = renderControlled({
      fields: [{ field: "kind" }],
    });

    expect(press(editor, "Tab")).toBe(true);
    expect(changes).toEqual([]);
  });

  it("accepts the active suggestion with Enter", () => {
    const onSearch = vi.fn();
    const { editor, changes } = renderControlled({
      fields: [{ field: "kind" }],
      onSearch,
    });

    press(editor, "Enter");

    expect(changes).toEqual(["kind:"]);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("adds a space and searches when a value suggestion completes a chip", () => {
    const onSearch = vi.fn();
    const { editor, changes } = renderControlled({
      value: "kind:f",
      fields: [{ field: "kind", values: ["fruit"] }],
      onSearch,
    });
    caretAt(editor, 6);

    press(editor, "Enter");

    expect(changes).toEqual(["kind:fruit "]);
    expect(onSearch).toHaveBeenCalledWith(
      "kind:fruit ",
      expect.objectContaining({ valid: true }),
    );
  });

  it("dismisses on Escape and reopens when typing resumes", () => {
    const { editor } = renderControlled({ fields: [{ field: "kind" }] });
    expect(editor.getAttribute("aria-expanded")).toBe("true");

    press(editor, "Escape");
    expect(editor.getAttribute("aria-expanded")).toBe("false");

    type(editor, "k");
    expect(editor.getAttribute("aria-expanded")).toBe("true");
  });

  /* ---------------------------------------------------------------- */
  /* Commit boundaries                                                */
  /* ---------------------------------------------------------------- */

  it("keeps ordinary value changes as drafts", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ value: "kind:f", onSearch });

    type(editor, "r", { anchor: 6, focus: 6 });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches when whitespace completes a valid chip", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ value: "kind:fruit", onSearch });

    type(editor, " ", { anchor: 10, focus: 10 });

    expect(onSearch).toHaveBeenCalledWith(
      "kind:fruit ",
      expect.objectContaining({ valid: true }),
    );
  });

  it("does not treat whitespace inside a quoted value as chip completion", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ value: 'name:"granny"', onSearch });

    type(editor, " ", { anchor: 12, focus: 12 });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches when stepping over an auto-inserted closer completes a chip", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ value: 'name:"fruit"', onSearch });
    caretAt(editor, 11);

    press(editor, '"');

    expect(onSearch).toHaveBeenCalledWith(
      'name:"fruit"',
      expect.objectContaining({ valid: true }),
    );
  });

  it("auto-pairs an opening delimiter and leaves the caret inside", () => {
    const { editor, changes, contexts } = renderControlled({ value: "name:" });
    caretAt(editor, 5);

    press(editor, '"');

    expect(changes).toEqual(['name:""']);
    expect(contexts.at(-1)?.caret).toBe(6);
  });

  it("normalizes lowercase boolean operators after a separator completes them", () => {
    const onSearch = vi.fn();
    const { editor, changes, contexts } = renderControlled({
      value: "kind:fruit an",
      onSearch,
    });

    type(editor, "d ", { anchor: 13, focus: 13 });

    expect(changes).toEqual(["kind:fruit and", "kind:fruit AND "]);
    expect(contexts.at(-1)?.valid).toBe(false);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not normalize an operator prefix while a field is being typed", () => {
    const { editor, changes } = renderControlled();

    type(editor, "origin:");

    expect(changes).toEqual([
      "o",
      "or",
      "ori",
      "orig",
      "origi",
      "origin",
      "origin:",
    ]);
  });

  it("does not submit while an IME composition is active", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ onSearch });

    press(editor, "Enter", { isComposing: true });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not search an incomplete field value", () => {
    const onSearch = vi.fn();
    const onContextChange = vi.fn();
    const { editor } = renderControlled({
      value: "kind:",
      onSearch,
      onContextChange,
    });

    press(editor, "Enter");
    act(() => editor.blur());

    expect(onContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ valid: false, ast: null }),
    );
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches a valid query on Enter and blur", () => {
    const onSearch = vi.fn();
    const { editor } = renderControlled({ value: "kind:fruit", onSearch });

    press(editor, "Enter");
    act(() => editor.blur());

    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith(
      "kind:fruit",
      expect.objectContaining({ valid: true }),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Chips                                                            */
  /* ---------------------------------------------------------------- */

  it("renders a removal control for every chip, in document order", () => {
    renderControlled({ value: "kind:fruit colors:green" });

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[data-slot="remove"]',
    );

    expect(
      [...buttons].map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Remove kind:fruit", "Remove colors:green"]);
  });

  it("renders no removal controls when editing is off", () => {
    renderControlled({ value: "kind:fruit", disabled: true });

    expect(container.querySelector('[data-slot="remove"]')).toBeNull();
  });

  it("marks the chip under the pointer", () => {
    renderControlled({ value: "kind:fruit" });
    const chip = container.querySelector<HTMLElement>('[data-slot="chip"]')!;

    act(() => {
      chip.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    });

    expect(chip.getAttribute("data-hovered")).toBe("true");
  });

  it("searches the remaining valid query after chip removal", () => {
    const onSearch = vi.fn();
    renderControlled({ value: "kind:fruit colors:green", onSearch });
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove kind:fruit"]',
    );

    act(() => remove?.click());

    expect(onSearch).toHaveBeenCalledWith(
      "colors:green",
      expect.objectContaining({ valid: true }),
    );
  });

  it("returns focus to the editor when Escape leaves a remove control", () => {
    const { editor } = renderControlled({ value: "kind:fruit" });
    const remove = container.querySelector<HTMLButtonElement>(
      'button[data-slot="remove"]',
    )!;

    act(() => remove.focus());
    expect(document.activeElement).toBe(remove);

    act(() => {
      remove.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.activeElement).toBe(editor);
  });

  it("does not treat focus moving to a remove control as leaving the component", () => {
    const onSearch = vi.fn();
    renderControlled({ value: "kind:fruit", onSearch });
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove kind:fruit"]',
    );

    act(() => remove?.focus());

    expect(onSearch).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* Errors and context                                               */
  /* ---------------------------------------------------------------- */

  it("associates parse errors with the editable element", () => {
    const { editor } = renderControlled({ value: "kind:" });
    act(() => editor.blur());
    const error = container.querySelector('[role="alert"]');

    expect(error).not.toBeNull();
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(editor.getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("reports caret-only context changes", () => {
    const onContextChange = vi.fn();
    const { editor } = renderControlled({
      value: "kind:fruit",
      onContextChange,
    });
    onContextChange.mockClear();

    caretAt(editor, 2);

    expect(onContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ caret: 2 }),
    );
  });

  it("reports the full selection, not only the caret", () => {
    const onContextChange = vi.fn();
    const { editor } = renderControlled({
      value: "kind:fruit",
      onContextChange,
    });

    caretAt(editor, 5, 10);

    expect(onContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        caret: 10,
        selection: { anchor: 5, focus: 10 },
      }),
    );
  });
});
