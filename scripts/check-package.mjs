import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.deepEqual(packageJson.sideEffects, ["**/*.css"]);

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
assert.equal(typeof core.stringify, "function");
assert.equal(typeof react.SearchInput, "object");
assert.equal(typeof react.useFieldSearch, "function");

console.log("package output is complete and importable");
