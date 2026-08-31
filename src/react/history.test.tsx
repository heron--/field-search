// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHistory, type HistoryController } from "./history";
import { collapsed } from "./selection";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useHistory", () => {
  let container: HTMLDivElement;
  let root: Root;
  let history: HistoryController;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function Harness() {
      history = useHistory("");
      return null;
    }
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const push = (value: string, mode?: "push" | "coalesce") =>
    history.record({ value, selection: collapsed(value.length) }, mode);

  it("has nothing to undo at the initial value", () => {
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it("walks back and forward through pushed states", () => {
    push("a");
    push("ab");

    expect(history.undo()?.value).toBe("a");
    expect(history.undo()?.value).toBe("");
    expect(history.undo()).toBeNull();
    expect(history.redo()?.value).toBe("a");
    expect(history.redo()?.value).toBe("ab");
    expect(history.redo()).toBeNull();
  });

  it("merges a run of coalesced edits into one step", () => {
    push("k", "coalesce");
    push("ki", "coalesce");
    push("kind", "coalesce");

    expect(history.undo()?.value).toBe("");
  });

  it("breaks the run when an edit is pushed instead of coalesced", () => {
    push("kind", "coalesce");
    push("kind ", "push");
    push("kind f", "coalesce");
    push("kind fr", "coalesce");

    expect(history.undo()?.value).toBe("kind ");
    expect(history.undo()?.value).toBe("kind");
  });

  it("restarts coalescing after an undo", () => {
    push("a", "coalesce");
    history.undo();
    push("b", "coalesce");

    expect(history.undo()?.value).toBe("");
  });

  it("drops the redo tail once a new edit lands", () => {
    push("a");
    push("ab");
    history.undo();
    push("ax");

    expect(history.redo()).toBeNull();
    expect(history.undo()?.value).toBe("a");
  });

  it("treats a repeated value as a caret move, not a new state", () => {
    push("a");
    history.record({ value: "a", selection: collapsed(0) });

    expect(history.undo()?.value).toBe("");
  });

  it("keeps the caret recorded with each state", () => {
    history.record({ value: "kind:fruit", selection: collapsed(4) });
    history.record({ value: "kind:fruits", selection: collapsed(11) });

    expect(history.undo()).toEqual({
      value: "kind:fruit",
      selection: { anchor: 4, focus: 4 },
    });
  });
});
