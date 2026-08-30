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

async function setQuery(page: Page, text: string) {
  await page.$eval(INPUT, (el) => {
    const input = el as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  });
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text);
  await new Promise((r) => setTimeout(r, 250));
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
await shoot(page, "03-pointer-on-close", FIELD);

await page.mouse.move(5, 5);
await setQuery(page, "co");
await new Promise((r) => setTimeout(r, 350));
await shoot(page, "04-suggestions-fields", ".pg");

await setQuery(page, "colors:gr");
await new Promise((r) => setTimeout(r, 350));
await shoot(page, "05-suggestions-values", ".pg");

// Mid-typing: the error must stay hidden while focused.
await setQuery(page, "kind:");
await shoot(page, "06-typing-no-error", FIELD);
await page.$eval(INPUT, (el) => (el as HTMLInputElement).blur());
await new Promise((r) => setTimeout(r, 250));
await shoot(page, "07-blurred-error", ".fs-root");

await browser.close();
