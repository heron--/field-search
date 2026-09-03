import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.deepEqual(packageJson.sideEffects, ["**/*.css"]);
assert.equal(packageJson.type, "module");
assert.equal(packageJson.types, "./dist/index.d.ts");
assert.deepEqual(packageJson.engines, { node: "^20.19.0 || >=22.12.0" });
assert.deepEqual(packageJson.exports["."], {
  types: "./dist/index.d.ts",
  import: "./dist/index.js",
  default: "./dist/index.js",
});
assert.deepEqual(packageJson.exports["./react"], {
  types: "./dist/react/index.d.ts",
  import: "./dist/react/index.js",
  default: "./dist/react/index.js",
});
assert.deepEqual(packageJson.exports["./react/radix-popover"], {
  types: "./dist/react/radix-popover.d.ts",
  import: "./dist/react/radix-popover.js",
  default: "./dist/react/radix-popover.js",
});

const require = createRequire(import.meta.url);
const requiredCore = require("field-search");
const requiredReact = require("field-search/react");
assert.equal(typeof requiredCore.parse, "function");
assert.equal(typeof requiredCore.format, "function");
assert.equal(typeof requiredReact.SearchInput, "object");
assert.equal(typeof requiredReact.useFieldSearch, "function");

// `field-search/react` must not statically import the optional
// `@radix-ui/react-popover` peer dependency; importing it without Radix
// installed must still succeed.
assert.equal(
  await readFile("dist/react/index.js", "utf8").then((source) =>
    source.includes("@radix-ui/react-popover"),
  ),
  false,
  "field-search/react must not statically import @radix-ui/react-popover",
);

for (const file of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react/index.js",
  "dist/react/index.d.ts",
  "dist/react/radix-popover.js",
  "dist/react/radix-popover.d.ts",
  "dist/base.css",
  "dist/theme.css",
  "dist/styles.css",
]) {
  await access(file);
}

const core = await import("../dist/index.js");
const react = await import("../dist/react/index.js");
const radixPopover = await import("../dist/react/radix-popover.js");
assert.equal(typeof core.parse, "function");
assert.equal(typeof core.format, "function");
assert.equal(typeof react.SearchInput, "object");
assert.equal(typeof react.useFieldSearch, "function");
assert.equal(typeof radixPopover.radixPopoverPrimitives, "object");

console.log("package output is complete and importable");
