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
  FieldSearchController,
  UseFieldSearchOptions,
} from "./useFieldSearch";

export { segment, segmentWithErrors, validate, caretTarget } from "./segments";
export type { Segment, SegmentKind, CaretTarget, Validation } from "./segments";
