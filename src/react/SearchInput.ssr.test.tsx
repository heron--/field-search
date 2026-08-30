import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchInput } from "./SearchInput";

describe("SearchInput SSR", () => {
  it("renders without accessing browser-only globals", () => {
    const html = renderToString(
      <SearchInput
        aria-label="Query"
        value="kind:fruit"
        onValueChange={() => {}}
      />,
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-slot="highlight-layer"');
  });
});
