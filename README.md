# field-search

A small fielded-query language with parsing, stringifying, tolerant editing
segments, and reusable React search-input primitives.

## Install

```sh
npm install field-search react react-dom
```

## Parse and stringify

```ts
import { parse, stringify } from "field-search";

const query = parse("kind:fruit colors:(red OR green)");
stringify(query);
```

## React input

Import the complete default appearance once in your application:

```tsx
import * as React from "react";
import { SearchInput } from "field-search/react";
import "field-search/styles.css";

export function Search() {
  const [value, setValue] = React.useState("");

  return (
    <SearchInput
      aria-label="Search inventory"
      name="query"
      value={value}
      onValueChange={setValue}
      fields={[
        { field: "kind", detail: "text", values: ["fruit", "vegetable"] },
        { field: "price", detail: "number" },
      ]}
    />
  );
}
```

`SearchInput` forwards its ref to the native input and accepts native input
attributes such as `id`, `name`, `disabled`, `required`, and ARIA labeling.

### Draft and committed queries

`onValueChange` reports every draft edit. `onSearch` is only called with a
valid `SearchContext` and fires when the user:

- presses Enter;
- leaves the input;
- accepts a suggestion or types a separator that completes a chip; or
- removes a chip.

Set `searchOnBlur`, `searchOnChipComplete`, or `searchOnRemove` to `false` to
opt out of an automatic commit boundary. `context.valid` is `false` for an
incomplete query such as `kind:`, so those drafts never execute a search. An
empty query is valid and can be used to clear a search.

Standalone `and` and `or` tokens are normalized to `AND` and `OR`, including
inside grouped values. Quoted text and ordinary values such as `name:and` are
left unchanged.

### Controlled and asynchronous suggestions

`onContextChange` also fires when the caret moves. Use it to load suggestions,
then supply those items through `suggestions`:

```tsx
<SearchInput
  value={value}
  onValueChange={setValue}
  onContextChange={(context) => loadOptions(context.target)}
  suggestions={options}
  suggestionsLoading={loading}
  loadingMessage="Loading…"
  emptyMessage="No matches"
/>
```

Suggestion labels and details accept React nodes. Use `renderSuggestion`,
`renderChip`, `suggestionsHeader`, and `renderError` when the default rendering
does not fit. `popoverProps` exposes Radix placement controls, while
`portalContainer` selects a custom portal destination.

### Headless composition

`useFieldSearch` provides parsing state, context, suggestions, and editing
operations without rendering markup or loading CSS. `Chip` and `Suggestions`
are also exported as ref-forwarding presentational primitives.

```tsx
const search = useFieldSearch({ value, onValueChange, suggestions });

search.context;
search.items;
search.accept(search.items[0]);
```

## Styling

The default theme is optional:

```ts
// Structural rules plus the default theme
import "field-search/styles.css";

// Structural rules only; add your own visual rules
import "field-search/base.css";
```

Library rules live in `field-search.base` and `field-search.theme` cascade
layers and use `:where()` selectors, so ordinary consumer CSS wins without an
`unstyled` runtime mode. Stable `data-slot` attributes and `classNames` hooks
are available for each component part.

Theme the input by setting custom properties on its root or a wrapper:

```css
.inventory-search {
  --fs-bg: #0f172a;
  --fs-fg: #e2e8f0;
  --fs-border: #334155;
  --fs-focus: #818cf8;
  --fs-chip-bg: #1e293b;
  --fs-chip-fg: #a5b4fc;
  --fs-chip-neg-bg: #3f1d2e;
  --fs-chip-neg-fg: #fca5a5;
  --fs-invalid: #f87171;
}
```

`layout.css` remains as a compatibility alias for `base.css`.

## Development

```sh
npm test
npm run typecheck
npm run build
```

For visual checks, run `npm run dev -- --port 5190` and then `npm run visual`.
The harness writes interaction-state screenshots to `/tmp/fs-shots`.

## License

MIT
