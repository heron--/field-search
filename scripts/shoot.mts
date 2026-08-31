/**
 * Visual and behavioural harness. Not part of the test suite — run it by hand:
 *   npx vite playground --port 5190 &
 *   npx tsx scripts/shoot.mts            (or: npx vite-node scripts/shoot.mts)
 *
 * Writes annotated PNGs to /tmp/fs-shots and asserts the things jsdom cannot
 * see: real chip geometry, caret placement, and the browser's own editing
 * pipeline driving the model.
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer, { type Page } from "puppeteer";

const URL = process.env.URL ?? "http://localhost:5190/";
const OUT = "/tmp/fs-shots";

const FIELD = ".fs-field";
const EDITOR = ".fs-editor";

async function shoot(page: Page, name: string, selector = ".pg") {
  const el = await page.$(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  const buffer = await el.screenshot();
  await writeFile(`${OUT}/${name}.png`, buffer);
  console.log(`wrote ${OUT}/${name}.png`);
}

/** The query as the DOM holds it. Remove controls carry no text of their own. */
async function query(page: Page) {
  return page.$eval(EDITOR, (node) => node.textContent ?? "");
}

async function setQuery(page: Page, text: string) {
  await page.$eval(EDITOR, (node) => {
    (node as HTMLElement).focus();
    const selection = node.ownerDocument.getSelection();
    selection?.selectAllChildren(node);
  });
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text);
  await new Promise((r) => setTimeout(r, 250));
}

async function committedQuery(page: Page) {
  return page.$eval(
    ".pg-committed code",
    (node) => node.textContent?.trim() ?? "",
  );
}

/** Put the caret at a model offset, the way the component itself would. */
async function caretAt(page: Page, offset: number) {
  await page.evaluate((target) => {
    const editor = document.querySelector(".fs-editor") as HTMLElement;
    editor.focus();
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          return (node as Element).hasAttribute("data-fs-nontext")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        },
      },
    );
    let base = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (target <= base + text.data.length) {
        document
          .getSelection()
          ?.setBaseAndExtent(text, target - base, text, target - base);
        return;
      }
      base += text.data.length;
    }
  }, offset);
  await new Promise((r) => setTimeout(r, 80));
}

async function chipBoxes(page: Page) {
  return page.$$eval(".fs-chip", (chips) =>
    chips.map((chip) => {
      const box = chip.getBoundingClientRect();
      // Measure the text alone: a range over the whole chip would union in the
      // out-of-flow remove control and hide the space reserved for it.
      const range = document.createRange();
      range.selectNodeContents(chip);
      const control = chip.querySelector("[data-fs-nontext]");
      if (control) range.setEndBefore(control);
      const text = range.getBoundingClientRect();
      return {
        text: chip.textContent ?? "",
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        padStart: text.left - box.left,
        padEnd: box.right - text.right,
        reserved: getComputedStyle(chip).paddingInlineEnd,
      };
    }),
  );
}

async function centerOf(page: Page, index: number) {
  return page.evaluate((i) => {
    const chip = [...document.querySelectorAll(".fs-chip")][i] as HTMLElement;
    const r = chip.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right };
  }, index);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--force-device-scale-factor=2", "--font-render-hinting=none"],
});
const page = await browser.newPage();

// The component logs a development-only error if the rendered text ever drifts
// from the query. Nothing here should trip it.
const consoleErrors: string[] = [];
page.on("console", (message) => {
  const text = message.text();
  // Resource 404s (a missing favicon, say) are the playground's business.
  if (
    message.type() === "error" &&
    !text.startsWith("Failed to load resource")
  ) {
    consoleErrors.push(text);
    console.log("console error:", text.slice(0, 80));
  }
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 2 });
// Headless Chrome only paints a caret in a frame it considers focused.
await page.bringToFront();
await mkdir(OUT, { recursive: true });
await page.goto(URL, { waitUntil: "networkidle2" });
// Transitions do not advance in a headless tab; land on the end state.
await page.addStyleTag({ content: "*{transition:none !important}" });
await new Promise((r) => setTimeout(r, 400));

const RESTING = "kind:fruit -colors:green calories:[10 TO 90]";
await setQuery(page, RESTING);
if ((await query(page)) !== RESTING) {
  throw new Error(`typing did not produce the query: ${await query(page)}`);
}
await page.$eval(EDITOR, (el) => (el as HTMLElement).blur());
await new Promise((r) => setTimeout(r, 200));
if ((await committedQuery(page)) !== RESTING) {
  throw new Error(`blur did not commit the valid query`);
}
await shoot(page, "01-resting", FIELD);

// The point of the refactor: chips are boxes with room of their own, and no
// second copy of the string to stay aligned with.
const boxes = await chipBoxes(page);
console.log("chip geometry:", boxes);
if (boxes.length !== 3)
  throw new Error(`expected 3 chips, got ${boxes.length}`);
if (boxes.some((box) => box.padStart < 3)) {
  throw new Error("chips have no leading padding");
}
if (boxes.some((box) => box.padEnd < 3)) {
  throw new Error("chips reserve no room for the remove control");
}
for (const [index, box] of boxes.slice(1).entries()) {
  const gap = box.left - boxes[index]!.right;
  if (gap < 1) throw new Error(`chips ${index} and ${index + 1} collide`);
}

const closes = await page.$$eval(".fs-close", (nodes) =>
  nodes.map((node) => {
    const button = node.getBoundingClientRect();
    const chip = node.closest(".fs-chip")!.getBoundingClientRect();
    return {
      inside:
        button.left >= chip.left - 0.5 && button.right <= chip.right + 0.5,
      width: button.width,
      height: +button.height.toFixed(1),
      chipHeight: +chip.height.toFixed(1),
      fillsHeight: Math.abs(button.height - chip.height) < 0.5,
      offCenter: +(
        (button.top + button.bottom) / 2 -
        (chip.top + chip.bottom) / 2
      ).toFixed(1),
      flushEnd: +(chip.right - button.right).toFixed(1),
      opacity: getComputedStyle(node).opacity,
    };
  }),
);
console.log("remove controls:", closes);
if (closes.length !== 3 || closes.some((close) => !close.inside)) {
  throw new Error("remove controls are not seated inside their chips");
}
if (closes.some((close) => Math.abs(close.offCenter) > 0.5)) {
  throw new Error("remove controls are not vertically centred in their chips");
}
if (closes.some((close) => !close.fillsHeight)) {
  throw new Error("remove controls do not fill their chip's height");
}
if (closes.some((close) => Math.abs(close.flushEnd) > 0.5)) {
  throw new Error(
    "remove controls are not flush with the chip's trailing edge",
  );
}

// The caret must actually paint over a chip's background. Nothing else here can
// see this: focus, caret-color and the selection range can all be perfectly
// correct while the caret is painted over by a positioned inline.
await setQuery(page, "kind:fruit apple");
await caretAt(page, 7);
const frames = new Set<string>();
for (let i = 0; i < 5; i++) {
  frames.add(Buffer.from(await page.$eval(EDITOR, () => "")).toString());
  frames.delete("");
  const shot = await (await page.$(EDITOR))!.screenshot();
  frames.add(Buffer.from(shot).toString("base64"));
  await new Promise((r) => setTimeout(r, 350));
}
console.log("caret blink frames:", frames.size);
if (frames.size < 2) {
  throw new Error("the caret does not paint inside a chip");
}

await setQuery(page, RESTING);
await page.$eval(EDITOR, (el) => (el as HTMLElement).blur());
await new Promise((r) => setTimeout(r, 200));

const chip = await centerOf(page, 0);
await page.mouse.move(chip.x, chip.y);
await new Promise((r) => setTimeout(r, 200));
await shoot(page, "02-hover-close", FIELD);

// Hovering must not move a single glyph: the geometry is static now.
const hoveredBoxes = await chipBoxes(page);
for (const [index, box] of hoveredBoxes.entries()) {
  if (Math.abs(box.left - boxes[index]!.left) > 0.5) {
    throw new Error(`hover reflowed chip ${index}`);
  }
}

await page.mouse.move(chip.right - 4, chip.y);
await new Promise((r) => setTimeout(r, 200));
await shoot(page, "03-pointer-on-close", FIELD);
await page.click('.fs-close[aria-label="Remove kind:fruit"]');
await new Promise((r) => setTimeout(r, 200));
const afterRemoval = "-colors:green calories:[10 TO 90]";
if ((await committedQuery(page)) !== afterRemoval) {
  throw new Error("chip removal did not commit the remaining query");
}

/* ---------------------------------------------------------------- */
/* Caret control                                                    */
/* ---------------------------------------------------------------- */

await setQuery(page, "kind:fruit apple");
await caretAt(page, 4);
await page.keyboard.type("s");
if ((await query(page)) !== "kinds:fruit apple") {
  throw new Error(`caret insertion landed wrong: ${await query(page)}`);
}

// Backspace on the boundary between two chips removes the space between them,
// leaving the segmentation to re-run rather than deleting a whole chip.
await caretAt(page, 12);
await page.keyboard.press("Backspace");
if ((await query(page)) !== "kinds:fruitapple") {
  throw new Error(`backspace at a boundary went wrong: ${await query(page)}`);
}

// The caret survives the re-render that every keystroke causes.
const caretOffset = await page.evaluate(() => {
  const editor = document.querySelector(".fs-editor") as HTMLElement;
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(editor, 0);
  range.setEnd(selection.focusNode!, selection.focusOffset);
  return range.toString().length;
});
if (caretOffset !== 11) {
  throw new Error(`caret drifted after re-render: ${caretOffset}`);
}

await page.keyboard.down("Meta");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Meta");
await new Promise((r) => setTimeout(r, 120));
if ((await query(page)) !== "kinds:fruit apple") {
  throw new Error(`undo did not restore the deletion: ${await query(page)}`);
}
await page.keyboard.down("Meta");
await page.keyboard.down("Shift");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Shift");
await page.keyboard.up("Meta");
await new Promise((r) => setTimeout(r, 120));
if ((await query(page)) !== "kinds:fruitapple") {
  throw new Error(`redo did not reapply the deletion: ${await query(page)}`);
}

// Enter must never break the line. Dismiss the suggestions first, or Enter
// means "accept the active item" rather than "search".
await setQuery(page, "kind:fruit");
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 120));
if ((await query(page)) !== "kind:fruit") {
  throw new Error(`Enter altered the query: ${await query(page)}`);
}
// One line means every top-level segment box shares a top edge. `white-space:
// pre` is the only thing holding that; `pre-wrap` is what a wrapping field needs.
const distinctTops = await page.$eval(EDITOR, (node) => {
  const tops = [...node.children].map((child) =>
    Math.round(child.getBoundingClientRect().top),
  );
  return new Set(tops).size;
});
if (distinctTops > 1) throw new Error("the field wrapped onto a second line");

/* ---------------------------------------------------------------- */
/* Suggestions                                                      */
/* ---------------------------------------------------------------- */

await page.mouse.move(5, 5);
await setQuery(page, "co");
await new Promise((r) => setTimeout(r, 350));
if ((await committedQuery(page)) !== "kind:fruit") {
  throw new Error("draft typing changed the committed query");
}
const combobox = await page.$eval(EDITOR, (editor) => {
  const controls = editor.getAttribute("aria-controls");
  const active = editor.getAttribute("aria-activedescendant");
  return {
    role: editor.getAttribute("role"),
    expanded: editor.getAttribute("aria-expanded"),
    editable: editor.getAttribute("contenteditable"),
    controlsListbox: Boolean(
      controls &&
      document.getElementById(controls)?.getAttribute("role") === "listbox",
    ),
    activeOption: Boolean(
      active &&
      document.getElementById(active)?.getAttribute("role") === "option",
    ),
  };
});
console.log("combobox wiring:", combobox);
if (
  combobox.role !== "combobox" ||
  combobox.expanded !== "true" ||
  !combobox.controlsListbox ||
  !combobox.activeOption
) {
  throw new Error("combobox ARIA relationship is incomplete");
}
if (combobox.editable !== "plaintext-only") {
  throw new Error(`expected plaintext-only, got ${combobox.editable}`);
}
await shoot(page, "04-suggestions-fields", ".pg");

await setQuery(page, "colors:gr");
await new Promise((r) => setTimeout(r, 350));
await shoot(page, "05-suggestions-values", ".pg");

// Mid-typing: the error must stay hidden while focused.
await setQuery(page, "kind:");
await shoot(page, "06-typing-no-error", FIELD);
await page.$eval(EDITOR, (el) => (el as HTMLElement).blur());
await new Promise((r) => setTimeout(r, 250));
if ((await committedQuery(page)) !== "kind:fruit") {
  throw new Error("an invalid blur executed a search");
}
await shoot(page, "07-blurred-error", ".fs-root");

await setQuery(page, "kind:fruit");
await page.keyboard.type(" ");
await new Promise((r) => setTimeout(r, 200));
if ((await committedQuery(page)) !== "kind:fruit") {
  throw new Error("finishing a chip did not commit the query");
}

// Tab walks the remove controls in document order, no emulation involved.
await setQuery(page, "kind:fruit colors:green");
await page.keyboard.press("Tab");
await new Promise((r) => setTimeout(r, 200));
const firstRemove = await page.evaluate(() =>
  document.activeElement?.getAttribute("aria-label"),
);
await page.keyboard.press("Tab");
await new Promise((r) => setTimeout(r, 200));
const secondRemove = await page.evaluate(() =>
  document.activeElement?.getAttribute("aria-label"),
);
console.log("tab order:", [firstRemove, secondRemove]);
if (
  firstRemove !== "Remove kind:fruit" ||
  secondRemove !== "Remove colors:green"
) {
  throw new Error("Tab did not walk the remove controls in order");
}
await page.keyboard.press("Tab");
await shoot(page, "08-keyboard-remove", FIELD);

// Scoped tokens must follow the suggestion list through its portal.
await page.$$eval(".pg-skin", (buttons) => {
  const midnight = buttons.find((button) => button.textContent === "Midnight");
  (midnight as HTMLButtonElement | undefined)?.click();
});
await setQuery(page, "co");
await new Promise((r) => setTimeout(r, 300));
await shoot(page, "09-midnight-suggestions", ".pg");

await setQuery(page, "kind:fruit and colors:green");
const normalized = await query(page);
if (normalized !== "kind:fruit AND colors:green") {
  throw new Error(`lowercase operator was not normalized: ${normalized}`);
}
await page.$eval(EDITOR, (el) => (el as HTMLElement).blur());
if ((await committedQuery(page)) !== normalized) {
  throw new Error("the normalized query was not committed on blur");
}

await page.$$eval(".pg-skin", (buttons) => {
  const custom = buttons.find((button) => button.textContent === "Custom");
  (custom as HTMLButtonElement | undefined)?.click();
});
await setQuery(page, "kind:fruit");
await page.$eval(EDITOR, (el) => (el as HTMLElement).blur());
await new Promise((r) => setTimeout(r, 200));
await shoot(page, "10-custom-classes", FIELD);

// The main input mixes immediate field suggestions with asynchronously loaded
// origin values and uses an accepted value to filter the result table.
await setQuery(page, "ori");
const typedFieldPrefix = await query(page);
if (typedFieldPrefix !== "ori") {
  throw new Error(`field prefix was normalized too early: ${typedFieldPrefix}`);
}
const fieldSuggestions = await page.$$eval(
  `[data-slot="suggestion-label"]`,
  (nodes) => nodes.map((node) => node.textContent?.trim()),
);
if (!fieldSuggestions.includes("origin:")) {
  throw new Error(`origin field suggestion was not shown: ${fieldSuggestions}`);
}

await setQuery(page, "origin:austr");
const loadingMessage = await page.$eval(`[role="status"]`, (node) =>
  node.textContent?.trim(),
);
if (loadingMessage !== "Loading countries from mock API…") {
  throw new Error(`async loading state was not shown: ${loadingMessage}`);
}
await shoot(page, "11-async-loading");
await new Promise((r) => setTimeout(r, 550));
const valueSuggestions = await page.$$eval(
  `[data-slot="suggestion-label"]`,
  (nodes) => nodes.map((node) => node.textContent?.trim()),
);
if (!valueSuggestions.includes("australia")) {
  throw new Error(
    `async value suggestions did not resolve: ${valueSuggestions}`,
  );
}
await shoot(page, "12-async-values");
await page.keyboard.press("Enter");
const acceptedAsyncValue = await query(page);
if (acceptedAsyncValue !== "origin:australia ") {
  throw new Error(`async suggestion was not accepted: ${acceptedAsyncValue}`);
}
await new Promise((r) => setTimeout(r, 100));
const filteredRows = await page.$$eval(".pg-table tbody tr", (rows) =>
  rows.map((row) => row.querySelector("td")?.textContent?.trim()),
);
if (
  !filteredRows.includes("granny smith") ||
  !filteredRows.includes("butternut squash") ||
  filteredRows.length !== 2
) {
  throw new Error(`async origin did not filter results: ${filteredRows}`);
}

// Mobile layout should stay within the viewport. Every chip now carries its own
// enlarged close target, so removal is a single tap with nothing to reveal.
await page.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await page.reload({ waitUntil: "networkidle2" });
await page.addStyleTag({ content: "*{transition:none !important}" });
await new Promise((r) => setTimeout(r, 500));
await setQuery(page, "kind:fruit colors:green");
const pageOverflows = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
if (pageOverflows) throw new Error("playground overflows the mobile viewport");

const mobileCloses = await page.$$eval(".fs-close", (nodes) =>
  nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      width: rect.width,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      label: node.getAttribute("aria-label"),
    };
  }),
);
console.log("mobile close targets:", mobileCloses);
if (mobileCloses.length !== 2 || mobileCloses.some((c) => c.width < 24)) {
  throw new Error(
    `mobile close geometry is invalid: ${JSON.stringify(mobileCloses)}`,
  );
}
await shoot(page, "13-mobile-close", ".pg-search");
const target = mobileCloses.find((c) => c.label === "Remove kind:fruit")!;
await page.touchscreen.tap(target.x, target.y);
await new Promise((r) => setTimeout(r, 200));
if ((await query(page)) !== "colors:green") {
  throw new Error(`mobile close did not remove the chip: ${await query(page)}`);
}
await shoot(page, "14-mobile-playground");

await browser.close();

if (consoleErrors.length > 0) {
  throw new Error(
    `console errors during the run:\n${consoleErrors.join("\n")}`,
  );
}
console.log("no console errors");
