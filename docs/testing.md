# Testing

There are two tiers, and the line between them is not about speed or taste —
it is about what each environment is physically capable of observing.

|                 | Environment          | Cost                | Owns                                                                          |
| --------------- | -------------------- | ------------------- | ----------------------------------------------------------------------------- |
| Unit suite      | Vitest + jsdom       | ~1.7s for 383 tests | Parsing, segmentation, model state, component behaviour, accessibility wiring |
| Browser harness | Puppeteer + Chromium | ~4.7s for 11 steps  | Paint, layout, and the browser's own editing pipeline                         |

jsdom has no paint, so it cannot see a caret. It reports zeros from
`getBoundingClientRect`, so it cannot see layout. It implements neither
`getTargetRanges` nor `contenteditable="plaintext-only"`. Everything else
belongs in the unit suite, where a check costs roughly a fortieth as much.

Known gaps in either tier are tracked as issues rather than listed here.

## Running things

```sh
npm test                          # unit suite
npm run test:watch
npm run typecheck

npm run visual:check              # browser assertions; this is what CI runs
npm run visual                    # assertions plus screenshots in /tmp/fs-shots
npm run visual -- --only=caret    # one step, for iterating
npm run visual -- --list          # available steps
```

`npm run visual` starts the playground itself. If something is already serving
the URL it reuses that and leaves it running, so a dev server you already have
open is never killed.

## The unit suite

Files are plain Vitest. Anything touching the DOM opts in per file with a
pragma, because most of the library needs no DOM at all:

```ts
// @vitest-environment jsdom
```

| File                                 | Covers                                      |
| ------------------------------------ | ------------------------------------------- |
| `src/parser.test.ts`                 | String to AST, and every parse error        |
| `src/stringify.test.ts`              | AST back to string, and round trips         |
| `src/react/segments.test.ts`         | Tolerant segmentation and caret targets     |
| `src/react/selection.test.ts`        | Model offset ↔ DOM position mapping         |
| `src/react/history.test.ts`          | Undo stack and coalescing rules             |
| `src/react/SearchInput.test.tsx`     | Component behaviour, editing, accessibility |
| `src/react/SearchInput.ssr.test.tsx` | Server rendering, no DOM globals            |
| `src/react/styles.test.ts`           | Stylesheet packaging and layering           |

One thing worth knowing about `SearchInput.test.tsx`: jsdom does not implement
`InputEvent.getTargetRanges`, so the component falls back to computing deletion
ranges itself. The unit suite therefore exercises the **fallback** path, and the
browser harness exercises Chrome's **target-range** path. Both are real; neither
substitutes for the other.

## The browser harness

`scripts/shoot.mts` is a list of independent named steps behind a small runner.

### The five parts of the file

**Configuration and arguments.** Selectors, viewports, and a small argument
parser. `MOD` resolves to `Meta` on macOS and `Control` elsewhere so the undo
step works on Linux CI.

**Page-side expressions.** `CHIPS`, `CLOSES`, `CARET_OFFSET`, `LINE_COUNT`,
`putCaret(offset)` and the `TEXT_WALKER` they share. These are template strings
rather than functions, and they compose by interpolation.

`CARET_OFFSET` and `putCaret` walk text nodes while skipping any
`[data-fs-nontext]` subtree — exactly what `src/react/selection.ts` does. The
harness and the component therefore share one coordinate system, so
`caretTo(7)` means the same offset the component means.

**Plumbing.** `check(condition, message)` throws a `CheckFailed`, a distinct
class so the runner can tell a failed expectation from a crash.
`startPlayground()` probes the URL and only spawns Vite if nothing answers.
`buildContext()` returns the vocabulary steps are written in.

**Steps.** A flat array of `{ name, shotsOnly?, run(context) }`.

**Runner.** Selects steps, launches Chromium, and executes each one.

### How a run flows

```
parse arguments
  ├─ --list?  print the step names and exit
  └─ select:  --only wins; otherwise everything except shotsOnly steps,
              unless --shots. An unknown name exits with the valid list.

start the playground        reuse whatever is serving, or spawn Vite
launch Chromium             plus --no-sandbox under CI
page.bringToFront()         required, or Chromium will not paint a caret
navigate, disable transitions

for each selected step:
    reset:  clear the query, blur, move the pointer away,
            wait for the committed query to settle
    run the step
    fail it if the page logged an error while it ran
    report ok or FAIL with a duration

close the browser, stop the playground if we started it
print a summary; exit non-zero if anything failed
```

Two properties of the runner matter more than the rest.

**Failures are collected, not thrown.** One pass reports everything that is
wrong. Fail-fast in a linear script means a wrong assertion early on hides
every check behind it.

**A step fails if the page logged a console error while it ran**, even when
every assertion passed. Errors are attributed to the step that was running, so
a React warning points at the interaction that caused it.

### Three techniques that are not obvious

**Page-side code is written as strings.** `page.evaluate(fn)` ships the source
of `fn` to the browser, so it cannot close over anything in Node. The
TypeScript loader also rewrites that source first: a _named_ helper declared
inside an `evaluate` callback gets wrapped in an esbuild shim that only exists
in the module scope, and the page throws `__name is not defined`. Strings avoid
the transform. Inline arrows are fine — it is named declarations inside the
callback that break.

**Caret visibility is measured by sampling the blink.** There is no API for
"is the caret painted". `caretPaints()` screenshots the field repeatedly and
asks whether any two frames differ; Chromium blinks the caret at roughly half
a second, so a difference means it is painting. It stops as soon as it finds
two distinct frames.

This is the only check that can see a hidden caret. Focus, `caret-color`, and
the selection range can all be provably correct while a positioned inline
paints over the caret — see the chip positioning note in the README.

**Setting a query and typing a query are different operations.**

|             | Mechanism                  | Cost                         | Use for                    |
| ----------- | -------------------------- | ---------------------------- | -------------------------- |
| `setQuery`  | one CDP `Input.insertText` | one round trip               | arranging state            |
| `typeQuery` | real key events            | one round trip per character | testing the input pipeline |

`setQuery` skips `keydown`, so it bypasses delimiter auto-pairing, and its text
still passes through operator normalization — `setQuery("kind:fruit and x")`
lands as `AND`. Write setup queries in canonical form. Use `typeQuery` when
auto-pairing, normalization, or undo coalescing is the subject, because all
three hang off real key events.

### Reproducing a failure that only happens in CI

CI runs on a slower machine than most laptops, which changes how React
interleaves renders. A check that fails there and passes locally is usually
reproducible by slowing the page down:

```sh
THROTTLE=4 npm run visual:check
THROTTLE=8 npm run visual -- --only=operator-normalization
```

`THROTTLE` applies CPU throttling at that multiplier. It turned an error that
appeared in roughly one local run in three into one that reproduced every time,
which is what made it fixable.

### Adding a step

```ts
{
  name: "my-thing",
  async run(context) {
    await context.setQuery("kind:fruit");
    const chips = await context.chips();
    check(chips.length === 1, `expected 1 chip, got ${chips.length}`);
    await context.shoot("99-my-thing", FIELD);   // no-op without --shots
  },
}
```

Three rules:

- **Never depend on another step.** Independence is what makes `--only` valid,
  and the runner resets the field before each step so you start from a known
  state.
- **Wait for conditions, not clocks.** `waitForQuery`, `waitForCommitted`, and
  `page.waitForSelector` are all faster and steadier than a sleep.
- **Assert invariants rather than exact pixels.** "Padding is greater than
  zero" and "hover moves nothing" survive a DOM restructure; a precise pixel
  relationship usually does not.

### Choosing a tier

Ask what would have to be true for jsdom to catch it. If the answer involves a
pixel, a painted glyph, a real key event, or an engine-specific editing API, it
belongs in the harness. Otherwise it belongs in the unit suite — and if you find
yourself writing a browser check for something jsdom could assert, you are
diluting the signal from the checks that genuinely need a browser.
