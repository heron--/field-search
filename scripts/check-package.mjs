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

const require = createRequire(import.meta.url);
const requiredCore = require("field-search");
const requiredReact = require("field-search/react");
assert.equal(typeof requiredCore.parse, "function");
assert.equal(typeof requiredCore.format, "function");
assert.equal(typeof requiredReact.SearchInput, "object");
assert.equal(typeof requiredReact.useFieldSearch, "function");

for (const file of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react/index.js",
  "dist/react/index.d.ts",
  "dist/base.css",
  "dist/layout.css",
  "dist/theme.css",
  "dist/styles.css",
]) {
  await access(file);
}

const core = await import("../dist/index.js");
const react = await import("../dist/react/index.js");
assert.equal(typeof core.parse, "function");
assert.equal(typeof core.format, "function");
assert.equal(typeof react.SearchInput, "object");
assert.equal(typeof react.useFieldSearch, "function");

console.log("package output is complete and importable");
