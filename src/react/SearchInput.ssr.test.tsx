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
    expect(html).toContain('data-slot="editor"');
    expect(html).toContain('data-slot="chip"');
    // `plaintext-only` is applied after mount, so the markup hydrates cleanly
    // in engines that do not support it. React serializes the attribute name
    // as written; HTML parses it case-insensitively.
    expect(html).toContain('contentEditable="true"');
  });
});
