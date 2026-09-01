# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0.0: breaking changes may land in minor versions, and
are called out explicitly below. Once 1.0.0 ships, releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Stable API

The following exports are considered stable for the 1.0.0 release. Breaking
changes to them will be called out in this file and, once 1.0.0 ships, will
require a major version bump:

- **Parser** — `parse`, `ParseError` (from `field-search`)
- **Formatter** — `format` (from `field-search`)
- **AST types** — the node interfaces and constructors exported from
  `field-search` (`QueryNode`, `FilterNode`, `TermNode`, `GroupNode`,
  `ScalarNode` and friends, plus the `exact`/`term`/`filter`/`and`/`or`/... AST
  builder functions)
- **React components** — `SearchInput`, `Chip`, `Suggestions`, `useFieldSearch`,
  `createSearchContext` (from `field-search/react`)

Everything else exported today (the selection/DOM-mapping helpers, segment
helpers, and CSS entry points other than `styles.css`) is not yet part of the
stable surface and may change without a major bump before 1.0.0. See #13 for
the tracked work required to reach 1.0.0.

## [Unreleased]

Changes since 0.1.0, targeted at 1.0.0 (tracked in #13).

### Changed

- **Breaking:** Renamed `stringify` to `format`. `format()` is the
  AST-to-string counterpart of `parse()`; `stringify` collided with
  `JSON.stringify` in imports.
- Clarified the ESM package exports (`package.json` `exports` map) and added
  a package-shape check script.

### Fixed

- Set a mobile-safe font size on the search input to avoid iOS Safari's
  automatic zoom-on-focus.

## [0.1.0] - 2026-08-31

Initial public release.

### Added

- Fielded-query language: parser (`parse`), formatter (`format`), and AST
  types/builders for terms, filters, comparisons, ranges, and boolean
  groups.
- React search-input primitives: `SearchInput`, `Chip`, `Suggestions`,
  `useFieldSearch`, `createSearchContext`, plus lower-level selection and
  segment helpers for consumers building their own editable field.
- A contenteditable-based combobox editor with IME composition handling,
  hover-reveal chip removal, and caret/selection syncing.
- Packaging metadata (`repository`, `homepage`, `bugs`, `keywords`) for the
  published npm package.

[Unreleased]: https://github.com/heron--/field-search/compare/main...HEAD
[0.1.0]: https://github.com/heron--/field-search/releases/tag/0.1.0
