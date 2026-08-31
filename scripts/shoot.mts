/**
 * Visual harness. Not part of the test suite — run it by hand:
 *   npx vite playground --port 5190 &
 *   npx tsx scripts/shoot.mts            (or: npx vite-node scripts/shoot.mts)
 *
 * Writes annotated PNGs to /tmp/fs-shots so the input can be eyeballed in the
 * states that are awkward to assert on: hover elevation, the close section,
 * the suggestion popover.
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer, { type Page } from "puppeteer";

const URL = process.env.URL ?? "http://localhost:5190/";
const OUT = "/tmp/fs-shots";

const FIELD = ".fs-field";
const INPUT = ".fs-native";

async function shoot(page: Page, name: string, selector = ".pg") {
  const el = await page.$(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  const buffer = await el.screenshot();
  await writeFile(`${OUT}/${name}.png`, buffer);
  console.log(`wrote ${OUT}/${name}.png`);
}

async function setQuery(page: Page, text: string, selector = INPUT) {
  await page.$eval(selector, (el) => {
    const input = el as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, input.value.length);
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
await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 2 });
await mkdir(OUT, { recursive: true });
await page.goto(URL, { waitUntil: "networkidle2" });
// Transitions do not advance in a headless tab; land on the end state.
await page.addStyleTag({ content: "*{transition:none !important}" });
await new Promise((r) => setTimeout(r, 400));

await setQuery(page, "kind:fruit -colors:green calories:[10 TO 90]");
await page.$eval(INPUT, (el) => (el as HTMLInputElement).blur());
await new Promise((r) => setTimeout(r, 200));
const initialCommit = await committedQuery(page);
if (initialCommit !== "kind:fruit -colors:green calories:[10 TO 90]") {
  throw new Error(`blur did not commit the valid query: ${initialCommit}`);
}
await shoot(page, "01-resting", FIELD);

const chip = await centerOf(page, 0);
await page.mouse.move(chip.x, chip.y);
await new Promise((r) => setTimeout(r, 200));
await shoot(page, "02-hover-close", FIELD);

// Pointer parked on the close section itself — it must survive the move.
await page.mouse.move(chip.right + 12, chip.y);
await new Promise((r) => setTimeout(r, 200));
const stillThere = await page.$(".fs-close");
console.log("close survives pointer move onto it:", Boolean(stillThere));
const activeChipAlignment = await page.evaluate(() => {
  const placeholder = [...document.querySelectorAll(".fs-layer .fs-chip")]
    .find((chip) => getComputedStyle(chip).visibility === "hidden")
    ?.getBoundingClientRect();
  const active = document
    .querySelector(".fs-active-chip")
    ?.getBoundingClientRect();
  const close = document.querySelector(".fs-close")?.getBoundingClientRect();
  return placeholder && active && close
    ? {
        left: Math.abs(placeholder.left - active.left),
        top: Math.abs(placeholder.top - active.top),
        height: Math.abs(placeholder.height - active.height),
        width: Math.abs(placeholder.width + close.width - active.width),
      }
    : null;
});
if (
  !activeChipAlignment ||
  Object.values(activeChipAlignment).some((difference) => difference > 0.5)
) {
  throw new Error(
    `active chip does not align with its placeholder: ${JSON.stringify(activeChipAlignment)}`,
  );
}
await shoot(page, "03-pointer-on-close", FIELD);
await page.click('.fs-close[aria-label="Remove kind:fruit"]');
await new Promise((r) => setTimeout(r, 200));
const afterRemoval = "-colors:green calories:[10 TO 90]";
if ((await committedQuery(page)) !== afterRemoval) {
  throw new Error("chip removal did not commit the remaining query");
}

await page.mouse.move(5, 5);
await setQuery(page, "co");
await new Promise((r) => setTimeout(r, 350));
if ((await committedQuery(page)) !== afterRemoval) {
  throw new Error("draft typing changed the committed query");
}
const combobox = await page.$eval(INPUT, (input) => {
  const controls = input.getAttribute("aria-controls");
  const active = input.getAttribute("aria-activedescendant");
  return {
    role: input.getAttribute("role"),
    expanded: input.getAttribute("aria-expanded"),
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
await shoot(page, "04-suggestions-fields", ".pg");

await setQuery(page, "colors:gr");
await new Promise((r) => setTimeout(r, 350));
await shoot(page, "05-suggestions-values", ".pg");

// Mid-typing: the error must stay hidden while focused.
await setQuery(page, "kind:");
await shoot(page, "06-typing-no-error", FIELD);
await page.$eval(INPUT, (el) => (el as HTMLInputElement).blur());
await new Promise((r) => setTimeout(r, 250));
if ((await committedQuery(page)) !== afterRemoval) {
  throw new Error("an invalid blur executed a search");
}
await shoot(page, "07-blurred-error", ".fs-root");

await setQuery(page, "kind:fruit");
await page.keyboard.type(" ");
await new Promise((r) => setTimeout(r, 200));
if ((await committedQuery(page)) !== "kind:fruit") {
  throw new Error("finishing a chip did not commit the query");
}

// Tab follows normal form navigation and reveals the first remove control.
await setQuery(page, "kind:fruit colors:green");
await page.keyboard.press("Tab");
await new Promise((r) => setTimeout(r, 200));
const focusedRemove = await page.evaluate(() =>
  document.activeElement?.getAttribute("aria-label"),
);
console.log("keyboard removal focus:", focusedRemove);
console.log(
  "keyboard removal geometry:",
  await page.evaluate(() => {
    const input = document.querySelector(".fs-native") as HTMLInputElement;
    const layer = document.querySelector(".fs-layer") as HTMLElement;
    const chips = [...document.querySelectorAll(".fs-chip")].map((chip) => ({
      text: chip.textContent,
      left: chip.getBoundingClientRect().left,
      right: chip.getBoundingClientRect().right,
    }));
    return {
      inputScroll: input.scrollLeft,
      layerScroll: layer.scrollLeft,
      chips,
    };
  }),
);
if (focusedRemove !== "Remove kind:fruit") {
  throw new Error("Tab did not reach the first remove control");
}
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
const normalized = await page.$eval(
  INPUT,
  (input) => (input as HTMLInputElement).value,
);
if (normalized !== "kind:fruit AND colors:green") {
  throw new Error(`lowercase operator was not normalized: ${normalized}`);
}
await page.$eval(INPUT, (el) => (el as HTMLInputElement).blur());
if ((await committedQuery(page)) !== normalized) {
  throw new Error("the normalized query was not committed on blur");
}

await page.$$eval(".pg-skin", (buttons) => {
  const custom = buttons.find((button) => button.textContent === "Custom");
  (custom as HTMLButtonElement | undefined)?.click();
});
await setQuery(page, "kind:fruit");
await page.$eval(INPUT, (el) => (el as HTMLInputElement).blur());
await new Promise((r) => setTimeout(r, 200));
await shoot(page, "10-custom-classes", FIELD);

// The main input mixes immediate field suggestions with asynchronously loaded
// origin values and uses an accepted value to filter the result table.
await setQuery(page, "ori");
const typedFieldPrefix = await page.$eval(
  INPUT,
  (input) => (input as HTMLInputElement).value,
);
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
const acceptedAsyncValue = await page.$eval(
  INPUT,
  (input) => (input as HTMLInputElement).value,
);
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

// Mobile layout should stay within the viewport. A touch reveals one enlarged
// close target instead of rendering every chip close control at once.
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

const mobileChip = await centerOf(page, 0);
await page.touchscreen.tap(mobileChip.x, mobileChip.y);
await new Promise((r) => setTimeout(r, 150));
const mobileClose = await page.$eval(
  '.fs-close[aria-label="Remove kind:fruit"]',
  (node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      visible: rect.width > 0 && getComputedStyle(element).display !== "none",
      opacity: getComputedStyle(element).opacity,
      width: rect.width,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  },
);
const visibleCloseCount = await page.$$eval(
  ".fs-close",
  (nodes) =>
    nodes.filter((node) => getComputedStyle(node).opacity === "1").length,
);
if (
  !mobileClose.visible ||
  mobileClose.opacity !== "1" ||
  mobileClose.width < 24 ||
  visibleCloseCount !== 1
) {
  throw new Error(
    `mobile close geometry is invalid: ${JSON.stringify({ mobileClose, visibleCloseCount })}`,
  );
}
await shoot(page, "13-mobile-close", ".pg-search");
await page.touchscreen.tap(mobileClose.x, mobileClose.y);
await new Promise((r) => setTimeout(r, 150));
const afterMobileRemoval = await page.$eval(
  INPUT,
  (input) => (input as HTMLInputElement).value,
);
if (afterMobileRemoval !== "colors:green") {
  throw new Error(
    `mobile close did not remove the chip: ${afterMobileRemoval}`,
  );
}
await shoot(page, "14-mobile-playground");

await browser.close();
