export { SearchInput } from "./SearchInput";
export type {
  SearchInputProps,
  SearchInputClassNames,
  SearchInputSlots,
  SearchContext,
  FieldSuggestion,
  SuggestionItem,
} from "./SearchInput";

export { Chip } from "./Chip";
export type { ChipProps, ChipClassNames } from "./Chip";

export { Suggestions } from "./Suggestions";
export type { SuggestionsProps, SuggestionClassNames } from "./Suggestions";

export {
  createSearchContext,
  defaultSuggestions,
  useFieldSearch,
} from "./useFieldSearch";
export type {
  CommitOptions,
  FieldSearchController,
  SearchMutation,
  UseFieldSearchOptions,
} from "./useFieldSearch";

/**
 * Model-offset/DOM-position mapping. Exported for consumers rendering their own
 * editable field on top of `useFieldSearch`.
 */
export {
  applySelection,
  collapsed,
  ordered,
  readSelection,
  readText,
  toDomPoint,
  toModelOffset,
  toModelRange,
} from "./selection";
export type { EditorSelection } from "./selection";

export {
  segment,
  segmentWithErrors,
  validate,
  caretTarget,
  normalizeOperators,
} from "./segments";
export type { Segment, SegmentKind, CaretTarget, Validation } from "./segments";
