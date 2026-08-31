import * as React from "react";
import { collapsed, type EditorSelection } from "./selection";

/**
 * An undo stack for the editable field.
 *
 * A native input comes with one; a `contenteditable` whose every edit is
 * intercepted and re-rendered from a model does not, because the browser's own
 * stack only records edits the browser was allowed to perform. So the model
 * owns history instead.
 *
 * Consecutive characters coalesce into one entry, and the caller breaks the run
 * at word boundaries, which makes undo land on whole words rather than
 * unwinding a whole phrase in one keystroke.
 */
export interface HistoryEntry {
  value: string;
  selection: EditorSelection;
}

export interface HistoryController {
  record: (entry: HistoryEntry, mode?: "push" | "coalesce") => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
}

const LIMIT = 200;

export function useHistory(initialValue: string): HistoryController {
  const entries = React.useRef<HistoryEntry[]>([
    { value: initialValue, selection: collapsed(initialValue.length) },
  ]);
  const position = React.useRef(0);
  const coalescing = React.useRef(false);

  const record = React.useCallback(
    (entry: HistoryEntry, mode: "push" | "coalesce" = "push") => {
      const current = entries.current[position.current];

      // A caret move is not a new state, it just updates where undo returns to.
      if (current && current.value === entry.value) {
        current.selection = entry.selection;
        return;
      }

      // Any new edit invalidates whatever redo was holding.
      entries.current.length = position.current + 1;

      if (mode === "coalesce" && coalescing.current && current) {
        entries.current[position.current] = entry;
      } else {
        entries.current.push(entry);
        position.current = entries.current.length - 1;
        if (entries.current.length > LIMIT) {
          entries.current.shift();
          position.current--;
        }
      }
      coalescing.current = mode === "coalesce";
    },
    [],
  );

  const undo = React.useCallback(() => {
    if (position.current <= 0) return null;
    position.current--;
    coalescing.current = false;
    return entries.current[position.current] ?? null;
  }, []);

  const redo = React.useCallback(() => {
    if (position.current >= entries.current.length - 1) return null;
    position.current++;
    coalescing.current = false;
    return entries.current[position.current] ?? null;
  }, []);

  return { record, undo, redo };
}
