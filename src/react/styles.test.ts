import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("React style packaging", () => {
  it("marks distributed CSS as side-effectful", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.sideEffects).toContain("**/*.css");
    expect(pkg.exports["./base.css"]).toBe("./dist/base.css");
  });

  it("keeps library styles low-specificity and layered", async () => {
    const [base, theme] = await Promise.all([
      readFile("src/react/base.css", "utf8"),
      readFile("src/react/theme.css", "utf8"),
    ]);

    expect(base).toContain("@layer field-search.base");
    expect(theme).toContain("@layer field-search.theme");
    expect(base).toContain(":where(");
    expect(theme).toContain(":where(");
    expect(theme).not.toContain(".fs-theme");
  });

  it("resolves responsive, overridable editor font sizes", async () => {
    const [base, theme] = await Promise.all([
      readFile("src/react/base.css", "utf8"),
      readFile("src/react/theme.css", "utf8"),
    ]);

    expect(theme).toContain("--fs-size-desktop: 14px");
    expect(theme).toContain("--fs-size-mobile: 16px");
    expect(base).toContain("--fs-size: var(--fs-size-desktop, 14px)");
    expect(base).toContain("@media (max-width: 767px)");
    expect(base).toContain("--fs-size: var(--fs-size-mobile, 16px)");
  });
});
