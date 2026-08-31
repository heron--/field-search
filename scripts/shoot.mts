/**
 * Browser harness for the things jsdom cannot see: paint, layout, and the
 * browser's own editing pipeline. Everything already covered by the unit suite
 * belongs there instead — a check here costs roughly forty times as much.
 *
 *   npm run visual:check                 assertions only
 *   npm run visual                       assertions plus screenshots
 *   npm run visual -- --only=caret       one step, for iterating
 *   npm run visual -- --list             what the steps are
 *
 * Steps are independent and each resets the playground first, so any subset can
 * run alone. A failing step is recorded and the run continues, so one pass
 * reports everything that is wrong rather than only the first thing.
 *
 * The playground is started automatically unless something already serves the
 * URL. Screenshots land in /tmp/fs-shots.
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import puppeteer, { type Page } from "puppeteer";

const OUT = "/tmp/fs-shots";
const EDITOR = ".fs-editor";
const FIELD = ".fs-field";
const ROOT = ".fs-root";
const RESTING = "kind:fruit -colors:green calories:[10 TO 90]";
/** Undo is Cmd on macOS, Ctrl elsewhere — CI runs on Linux. */
const MOD = process.platform === "darwin" ? "Meta" : "Control";
/** Delete-word is Option on macOS, Ctrl elsewhere. */
const WORD_MOD = process.platform === "darwin" ? "Alt" : "Control";
const DESKTOP = { width: 1180, height: 900, deviceScaleFactor: 2 };
const MOBILE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/* ------------------------------------------------------------------ */
/* Arguments                                                          */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const hasFlag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) =>
  argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const wantShots = hasFlag("shots");
const only = option("only")
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const port = Number(option("port") ?? 5190);
const url = option("url") ?? process.env.URL ?? `http://localhost:${port}/`;

/* ------------------------------------------------------------------ */
/* Page-side expressions                                              */
/*                                                                    */
/* Written as strings on purpose: the TypeScript loader rewrites named */
/* helpers inside `evaluate` callbacks into references the page cannot */
/* resolve.                                                           */
/* ------------------------------------------------------------------ */

const TEXT_WALKER = `document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
  acceptNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
    return node.hasAttribute("data-fs-nontext")
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_SKIP;
  },
})`;

/** Chip boxes, with the text extent measured apart from the remove control. */
const CHIPS = `[...document.querySelectorAll(".fs-chip")].map((chip) => {
  const box = chip.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(chip);
  const control = chip.querySelector("[data-fs-nontext]");
  if (control) range.setEndBefore(control);
  const text = range.getBoundingClientRect();
  return {
    text: chip.textContent,
    left: +box.left.toFixed(2),
    right: +box.right.toFixed(2),
    top: Math.round(box.top),
    bottom: box.bottom,
    padStart: +(text.left - box.left).toFixed(2),
    padEnd: +(box.right - text.right).toFixed(2),
  };
})`;

const CLOSES = `[...document.querySelectorAll(".fs-close")].map((node) => {
  const button = node.getBoundingClientRect();
  const chip = node.closest(".fs-chip").getBoundingClientRect();
  return {
    label: node.getAttribute("aria-label"),
    inside: button.left >= chip.left - 0.5 && button.right <= chip.right + 0.5,
    width: +button.width.toFixed(1),
    fillsHeight: Math.abs(button.height - chip.height) < 0.5,
    offCenter: +(
      (button.top + button.bottom) / 2 - (chip.top + chip.bottom) / 2
    ).toFixed(1),
    flushEnd: +(chip.right - button.right).toFixed(1),
    opacity: getComputedStyle(node).opacity,
    centre: {
      x: button.left + button.width / 2,
      y: button.top + button.height / 2,
    },
  };
})`;

/** Model offset of the caret, counted the way selection.ts counts it. */
const CARET_OFFSET = `(() => {
  const root = document.querySelector("${EDITOR}");
  const selection = document.getSelection();
  if (!root || !selection || !selection.focusNode) return -1;
  const walker = ${TEXT_WALKER};
  let base = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === selection.focusNode) return base + selection.focusOffset;
    base += node.data.length;
  }
  return -1;
})()`;

const putCaret = (offset: number) => `(() => {
  const root = document.querySelector("${EDITOR}");
  root.focus();
  const walker = ${TEXT_WALKER};
  let base = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (${offset} <= base + node.data.length) {
      const local = ${offset} - base;
      document.getSelection().setBaseAndExtent(node, local, node, local);
      return true;
    }
    base += node.data.length;
  }
  return false;
})()`;

/** Distinct top edges of the top-level segment boxes; 1 means a single line. */
const LINE_COUNT = `(() => {
  const root = document.querySelector("${EDITOR}");
  const tops = [...root.children].map((child) =>
    Math.round(child.getBoundingClientRect().top),
  );
  return new Set(tops).size;
})()`;

/* ------------------------------------------------------------------ */
/* Harness plumbing                                                   */
/* ------------------------------------------------------------------ */

class CheckFailed extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message);
}

interface ChipBox {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  padStart: number;
  padEnd: number;
}

interface CloseBox {
  label: string;
  inside: boolean;
  width: number;
  fillsHeight: boolean;
  offCenter: number;
  flushEnd: number;
  opacity: string;
  centre: { x: number; y: number };
}

interface Context {
  page: Page;
  shots: boolean;
  note: (label: string, detail: unknown) => void;
  shoot: (name: string, selector?: string) => Promise<void>;
  /** Replace the query in one operation. Faster, and normalizes as it lands. */
  setQuery: (text: string) => Promise<void>;
  /** Replace the query with real keystrokes, for testing the input pipeline. */
  typeQuery: (text: string) => Promise<void>;
  query: () => Promise<string>;
  committed: () => Promise<string>;
  waitForQuery: (text: string) => Promise<void>;
  waitForCommitted: (text: string) => Promise<void>;
  caretTo: (offset: number) => Promise<void>;
  caretOffset: () => Promise<number>;
  chips: () => Promise<ChipBox[]>;
  closes: () => Promise<CloseBox[]>;
  lineCount: () => Promise<number>;
  blur: () => Promise<void>;
  caretPaints: () => Promise<boolean>;
}

interface Step {
  name: string;
  /** Produces screenshots only; skipped when running assertions alone. */
  shotsOnly?: boolean;
  run: (context: Context) => Promise<void>;
}

async function reachable(target: string) {
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startPlayground(): Promise<() => void> {
  if (await reachable(url)) {
    console.log(`using the playground already serving ${url}`);
    return () => {};
  }
  const child = spawn(
    "npx",
    ["vite", "playground", "--port", String(port), "--strictPort"],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await reachable(url)) {
      console.log(`started the playground on ${url}`);
      return () => child.kill("SIGTERM");
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`the playground never came up on ${url}`);
}

function buildContext(page: Page, shots: boolean): Context {
  const expression = <T,>(source: string) =>
    page.evaluate(source) as Promise<T>;

  const waitFor = (source: string, description: string) =>
    page
      .waitForFunction(source, { timeout: 5000, polling: 50 })
      .then(() => undefined)
      .catch(() => {
        throw new CheckFailed(`timed out waiting for ${description}`);
      });

  const query = () => page.$eval(EDITOR, (node) => node.textContent ?? "");
  const committed = () =>
    page.$eval(".pg-committed code", (node) => node.textContent?.trim() ?? "");

  const waitForQuery = (text: string) =>
    waitFor(
      `(() => (document.querySelector("${EDITOR}")?.textContent ?? "") === ${JSON.stringify(text)})()`,
      `the query to be ${JSON.stringify(text)}`,
    );

  const waitForCommitted = (text: string) =>
    waitFor(
      `(() => (document.querySelector(".pg-committed code")?.textContent ?? "").trim() === ${JSON.stringify(text)})()`,
      `the committed query to be ${JSON.stringify(text)}`,
    );

  const selectAll = () =>
    page.$eval(EDITOR, (node) => {
      (node as HTMLElement).focus();
      node.ownerDocument.getSelection()?.selectAllChildren(node);
    });

  return {
    page,
    shots,
    note: (label, detail) => console.log(`        ${label}:`, detail),
    async shoot(name, selector = ".pg") {
      if (!shots) return;
      const element = await page.$(selector);
      check(element, `no element for ${selector}`);
      await writeFile(`${OUT}/${name}.png`, await element.screenshot());
    },
    async setQuery(text) {
      await selectAll();
      if (text === "") await page.keyboard.press("Backspace");
      // One insertion rather than one per character: hundreds of round trips
      // become one, and the component sees a single `insertText`. Despite the
      // name, this maps to CDP `Input.insertText` and takes a whole string.
      else await page.keyboard.sendCharacter(text);
      await waitForQuery(text);
    },
    async typeQuery(text) {
      await selectAll();
      await page.keyboard.press("Backspace");
      if (text) await page.keyboard.type(text);
    },
    query,
    committed,
    waitForQuery,
    waitForCommitted,
    async caretTo(offset) {
      const placed = await expression<boolean>(putCaret(offset));
      check(placed, `could not place the caret at ${offset}`);
    },
    caretOffset: () => expression<number>(CARET_OFFSET),
    chips: () => expression<ChipBox[]>(CHIPS),
    closes: () => expression<CloseBox[]>(CLOSES),
    lineCount: () => expression<number>(LINE_COUNT),
    blur: () => page.$eval(EDITOR, (node) => (node as HTMLElement).blur()),
    /**
     * Whether the caret is painted at all, by sampling for the blink. Focus,
     * `caret-color` and the selection range can all be correct while a
     * positioned inline paints over the caret, and nothing else here sees that.
     */
    async caretPaints() {
      const element = await page.$(EDITOR);
      check(element, "no editor to sample");
      const frames = new Set<string>();
      for (let sample = 0; sample < 8; sample++) {
        frames.add(Buffer.from(await element.screenshot()).toString("base64"));
        if (frames.size > 1) return true;
        await new Promise((resolve) => setTimeout(resolve, 280));
      }
      return false;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Steps                                                              */
/* ------------------------------------------------------------------ */

const steps: Step[] = [
  {
    name: "editable",
    async run({ page }) {
      const state = await page.$eval(EDITOR, (node) => ({
        editable: node.getAttribute("contenteditable"),
        multiline: node.getAttribute("aria-multiline"),
      }));
      check(
        state.editable === "plaintext-only",
        `expected plaintext-only, got ${state.editable}`,
      );
      check(state.multiline === "false", "the field is not marked single-line");
    },
  },

  {
    name: "layout",
    async run(context) {
      await context.setQuery(RESTING);
      await context.blur();
      await context.shoot("01-resting", FIELD);

      // Guards the emulation itself: without it this step silently checks the
      // coarse-pointer behaviour instead, which is what CI was doing.
      check(
        await context.page.evaluate(
          'matchMedia("(hover: hover) and (pointer: fine)").matches',
        ),
        "the harness is not emulating a fine pointer",
      );

      const chips = await context.chips();
      context.note("chips", chips.length);
      check(chips.length === 3, `expected 3 chips, got ${chips.length}`);
      check(
        chips.every((chip) => chip.padStart >= 3),
        "chips have no leading padding",
      );
      // At rest the chip is compact: no room held open for a control that is
      // not shown, so the trailing padding is only the chip's own.
      check(
        chips.every((chip) => Math.abs(chip.padEnd - chip.padStart) <= 0.5),
        `chips hold room open at rest: ${chips.map((c) => c.padEnd).join(", ")}`,
      );
      check(
        new Set(chips.map((chip) => chip.top)).size === 1,
        "chips are not on one line",
      );
      for (const [index, chip] of chips.slice(1).entries()) {
        const gap = chip.left - chips[index]!.right;
        check(gap >= 1, `chips ${index} and ${index + 1} collide`);
      }

      const resting = await context.closes();
      check(resting.length === 3, `expected 3 remove controls`);
      // Easy to break without noticing: every other check here passes either
      // way, so the reveal has to be asserted on its own.
      check(
        resting.every((close) => close.opacity === "0"),
        `remove controls are visible at rest: ${resting.map((c) => c.opacity).join(", ")}`,
      );

      const first = chips[0]!;
      await context.page.mouse.move(
        (first.left + first.right) / 2,
        (await context.page.$eval(
          EDITOR,
          (n) => n.getBoundingClientRect().top,
        )) + 20,
      );
      await context.shoot("02-hover-close", FIELD);

      const revealed = await context.closes();
      check(
        revealed[0]?.opacity === "1",
        `hovering a chip did not reveal its remove control: ${revealed[0]?.opacity}`,
      );
      check(
        revealed.slice(1).every((close) => close.opacity === "0"),
        "hovering one chip revealed the others' remove controls",
      );

      // Geometry is only meaningful once the chip has grown around the control.
      const control = revealed[0]!;
      check(control.inside, "the remove control is not inside its chip");
      check(control.fillsHeight, "the remove control does not fill the chip");
      check(
        Math.abs(control.offCenter) <= 0.5,
        "the remove control is not vertically centred",
      );
      check(
        Math.abs(control.flushEnd) <= 0.5,
        "the remove control is not flush with the chip's trailing edge",
      );

      // Only the trailing edge moves, so the pointer that triggered the growth
      // stays inside the chip it grew.
      const hovered = await context.chips();
      const growth = hovered[0]!.right - chips[0]!.right;
      context.note("hover growth", growth);
      check(
        Math.abs(hovered[0]!.left - chips[0]!.left) <= 0.5,
        "hovering moved the chip's leading edge",
      );
      check(growth > 0, "hovering did not grow the chip");
      // Growth is less than the control's width, because the hovered padding
      // replaces the chip's own trailing padding rather than adding to it. What
      // has to hold is that the control now fits in that padding.
      check(
        hovered[0]!.padEnd >= control.width,
        `the control needs ${control.width}px but has ${hovered[0]!.padEnd}px`,
      );
      for (const [index, chip] of hovered.slice(1).entries()) {
        const shift = chip.left - chips[index + 1]!.left;
        check(
          Math.abs(shift - growth) <= 0.5,
          `chip ${index + 1} shifted ${shift}px, expected ${growth}px`,
        );
      }
      check(
        new Set(hovered.map((chip) => chip.top)).size === 1,
        "growing a chip pushed another onto a second line",
      );
    },
  },

  {
    name: "caret",
    async run(context) {
      await context.setQuery("kind:fruit apple");
      // Offset 7 sits inside the first chip, over its background.
      await context.caretTo(7);
      check(await context.caretPaints(), "the caret does not paint in a chip");
    },
  },

  {
    name: "caret-control",
    async run(context) {
      await context.setQuery("kind:fruit apple");

      await context.caretTo(4);
      await context.page.keyboard.type("s");
      await context.waitForQuery("kinds:fruit apple");

      // The boundary between two chips: this removes the space between them
      // rather than a whole chip.
      await context.caretTo(12);
      await context.page.keyboard.press("Backspace");
      await context.waitForQuery("kinds:fruitapple");

      const offset = await context.caretOffset();
      check(
        offset === 11,
        `the caret drifted across the re-render: ${offset} rather than 11`,
      );
    },
  },

  {
    name: "deletion",
    async run(context) {
      // Chrome hands `beforeinput` an explicit target range, so this exercises
      // a different path from the unit suite, which only has the fallback.
      await context.setQuery("name:a👍🏽");
      await context.caretTo("name:a👍🏽".length);
      await context.page.keyboard.press("Backspace");
      await context.waitForQuery("name:a");
    },
  },

  {
    name: "deletion-fallback",
    async run(context) {
      // Engines that supply no target range make the component compute the
      // deletion itself. Every current browser supplies one, so the only way to
      // exercise that code against real keystrokes is to take the API away.
      await context.page.evaluate(
        `window.__realTargetRanges = InputEvent.prototype.getTargetRanges;
         InputEvent.prototype.getTargetRanges = function () { return []; };`,
      );
      try {
        await context.setQuery("name:a👍🏽");
        await context.caretTo("name:a👍🏽".length);
        await context.page.keyboard.press("Backspace");
        // One grapheme, not one code unit: the surrogate pair and its modifier
        // go together.
        await context.waitForQuery("name:a");

        await context.setQuery("kind:fruit apple");
        await context.caretTo(16);
        await context.page.keyboard.down(WORD_MOD);
        await context.page.keyboard.press("Backspace");
        await context.page.keyboard.up(WORD_MOD);
        await context.waitForQuery("kind:fruit ");
      } finally {
        await context.page.evaluate(
          `InputEvent.prototype.getTargetRanges = window.__realTargetRanges;`,
        );
      }
    },
  },

  {
    name: "composition",
    async run(context) {
      // Composition is the one edit the component lets the browser perform, so
      // it is the one path where the DOM leads and the model follows.
      const cdp = await context.page.createCDPSession();
      try {
        await context.setQuery("name:");
        await context.caretTo(5);

        for (const text of ["に", "にほ", "にほん"]) {
          await cdp.send("Input.imeSetComposition", {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
          });
        }

        // Mid-composition the DOM carries the preedit and the model must not
        // have moved, or React would have clobbered what the IME is editing.
        const midway = await context.query();
        check(
          midway.includes("にほん"),
          `the preedit is not in the field: ${JSON.stringify(midway)}`,
        );

        await cdp.send("Input.insertText", { text: "日本" });
        await context.waitForQuery("name:日本");

        const caret = await context.caretOffset();
        check(caret === 7, `caret sits at ${caret}, expected 7`);

        // Harder: compose in the middle, with segments either side that have to
        // be re-cut around the composed text.
        await context.setQuery("kind:fruit apple");
        await context.caretTo(10);
        await cdp.send("Input.imeSetComposition", {
          text: "かき",
          selectionStart: 2,
          selectionEnd: 2,
        });
        await cdp.send("Input.insertText", { text: "柿" });
        await context.waitForQuery("kind:fruit柿 apple");

        const middle = await context.caretOffset();
        check(middle === 11, `caret sits at ${middle}, expected 11`);
      } finally {
        await cdp.detach();
      }
    },
  },

  {
    name: "history",
    async run(context) {
      await context.setQuery("kind:");
      await context.caretTo(5);
      // Real keystrokes, so a run of typing coalesces into one undo step.
      await context.page.keyboard.type("fruit");
      await context.waitForQuery("kind:fruit");

      await context.page.keyboard.down(MOD);
      await context.page.keyboard.press("KeyZ");
      await context.page.keyboard.up(MOD);
      await context.waitForQuery("kind:");

      await context.page.keyboard.down(MOD);
      await context.page.keyboard.down("Shift");
      await context.page.keyboard.press("KeyZ");
      await context.page.keyboard.up("Shift");
      await context.page.keyboard.up(MOD);
      await context.waitForQuery("kind:fruit");
    },
  },

  {
    name: "auto-pairing",
    async run(context) {
      // Delimiters pair on keydown, which only real keystrokes reach: typing
      // `[` inserts `[]`, and typing the closer steps over it.
      await context.typeQuery("calories:[10 TO 90]");
      await context.waitForQuery("calories:[10 TO 90]");
      await context.typeQuery('name:"granny smith"');
      await context.waitForQuery('name:"granny smith"');
    },
  },

  {
    name: "operator-normalization",
    async run(context) {
      await context.typeQuery("kind:fruit and colors:green");
      await context.waitForQuery("kind:fruit AND colors:green");
    },
  },

  {
    name: "chip-complete",
    async run(context) {
      // A separator completing a valid chip commits the query.
      await context.setQuery("kind:fruit");
      await context.caretTo(10);
      await context.page.keyboard.type(" ");
      await context.waitForCommitted("kind:fruit");
    },
  },

  {
    name: "single-line",
    async run(context) {
      await context.setQuery("kind:fruit");
      // Dismiss the suggestions, or Enter means "accept the active item".
      await context.page.keyboard.press("Escape");
      await context.page.keyboard.press("Enter");
      await context.waitForQuery("kind:fruit");

      const lines = await context.lineCount();
      check(lines === 1, `the field wrapped onto ${lines} lines`);
    },
  },

  {
    name: "keyboard-nav",
    async run(context) {
      await context.setQuery("kind:fruit colors:green");
      await context.page.keyboard.press("Escape");

      await context.page.keyboard.press("Tab");
      const first = await context.page.evaluate(
        "document.activeElement?.getAttribute('aria-label')",
      );
      await context.page.keyboard.press("Tab");
      const second = await context.page.evaluate(
        "document.activeElement?.getAttribute('aria-label')",
      );
      context.note("tab order", [first, second]);
      check(
        first === "Remove kind:fruit" && second === "Remove colors:green",
        `Tab did not walk the remove controls: ${first}, ${second}`,
      );

      // Escape hands focus back to the field.
      await context.page.keyboard.press("Escape");
      const returned = await context.page.evaluate(
        "document.activeElement?.classList.contains('fs-editor')",
      );
      check(returned, "Escape did not return focus to the field");

      await context.shoot("03-keyboard-remove", FIELD);
    },
  },

  {
    name: "remove",
    async run(context) {
      await context.setQuery(RESTING);
      await context.blur();

      // The control is inert until hovering the chip reveals it, so reach it
      // the way a pointer does: over the chip first, then onto the control.
      const [chip] = await context.chips();
      check(chip, "no chip to remove");
      const middle = (chip.top + chip.bottom) / 2;
      await context.page.mouse.move((chip.left + chip.right) / 2, middle);
      const [control] = await context.closes();
      check(control, "hovering did not reveal a remove control");
      await context.page.mouse.click(control.centre.x, control.centre.y);

      await context.waitForCommitted("-colors:green calories:[10 TO 90]");
    },
  },

  {
    name: "mobile",
    async run(context) {
      try {
        await context.page.setViewport(MOBILE);
        await emulatePointer("coarse");
        await context.page.reload({ waitUntil: "domcontentloaded" });
        await context.page.waitForSelector(EDITOR);
        await context.page.addStyleTag({
          content: "*{transition:none !important}",
        });
        await context.setQuery("kind:fruit colors:green");

        check(
          await context.page.evaluate(
            'matchMedia("(hover: none) and (pointer: coarse)").matches',
          ),
          "the harness is not emulating a coarse pointer",
        );

        const overflows = await context.page.evaluate(
          "document.documentElement.scrollWidth > window.innerWidth",
        );
        check(!overflows, "the playground overflows the mobile viewport");

        const closes = await context.closes();
        context.note(
          "touch targets",
          closes.map((close) => close.width),
        );
        check(closes.length === 2, "expected one remove control per chip");
        check(
          closes.every((close) => close.width >= 24),
          "remove controls are below the 24px touch target",
        );
        // No hover to reveal them with, so they have to be visible already.
        check(
          closes.every((close) => close.opacity === "1"),
          "remove controls are hidden on a device that cannot hover",
        );

        await context.shoot("04-mobile", ".pg-search");

        const target = closes.find(
          (close) => close.label === "Remove kind:fruit",
        );
        check(target, "no remove control for the first chip");
        await context.page.touchscreen.tap(target.centre.x, target.centre.y);
        await context.waitForQuery("colors:green");
      } finally {
        await context.page.setViewport(DESKTOP);
        await emulatePointer("fine");
        await context.page.reload({ waitUntil: "domcontentloaded" });
        await context.page.waitForSelector(EDITOR);
        await context.page.addStyleTag({
          content: "*{transition:none !important}",
        });
      }
    },
  },

  {
    name: "screenshots",
    shotsOnly: true,
    async run(context) {
      const { page } = context;

      await context.setQuery("co");
      await page.waitForSelector('[role="option"]');
      await context.shoot("05-suggestions-fields");

      await context.setQuery("colors:gr");
      await page.waitForSelector('[role="option"]');
      await context.shoot("06-suggestions-values");

      // Errors stay hidden while the field has focus, and appear after blur.
      await context.setQuery("kind:");
      await context.shoot("07-typing-no-error", FIELD);
      await context.blur();
      await page.waitForSelector('[role="alert"]');
      await context.shoot("08-blurred-error", ROOT);

      // Asynchronous origin values, loading and resolved.
      await context.setQuery("origin:austr");
      await page.waitForSelector('[role="status"]');
      await context.shoot("09-async-loading");
      await page.waitForFunction(
        `(() => [...document.querySelectorAll('[data-slot="suggestion-label"]')]
           .some((node) => node.textContent?.trim() === "australia"))()`,
        { timeout: 5000, polling: 50 },
      );
      await context.shoot("10-async-values");

      // Scoped theme tokens must follow the popover through its portal.
      for (const [skin, name] of [
        ["Midnight", "11-midnight"],
        ["Custom", "12-custom-classes"],
      ] as const) {
        await page.$$eval(
          ".pg-skin",
          (buttons, label) => {
            const match = buttons.find(
              (button) => button.textContent === label,
            );
            (match as HTMLButtonElement | undefined)?.click();
          },
          skin,
        );
        await context.setQuery("co");
        await page.waitForSelector('[role="option"]');
        await context.shoot(name);
      }

      await page.$$eval(".pg-skin", (buttons) => {
        const first = buttons.find(
          (button) => button.textContent === "Default",
        );
        (first as HTMLButtonElement | undefined)?.click();
      });
    },
  },
];

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

if (hasFlag("list")) {
  for (const step of steps) {
    console.log(`${step.name}${step.shotsOnly ? "  (screenshots only)" : ""}`);
  }
  process.exit(0);
}

const selected = steps.filter((step) => {
  if (only) return only.includes(step.name);
  return wantShots || !step.shotsOnly;
});

if (only) {
  const unknown = only.filter(
    (name) => !steps.some((step) => step.name === name),
  );
  if (unknown.length > 0) {
    console.error(`unknown step(s): ${unknown.join(", ")}`);
    console.error(`available: ${steps.map((step) => step.name).join(", ")}`);
    process.exit(2);
  }
}

const stopPlayground = await startPlayground();
// Cleared so a renamed or removed step cannot leave a stale image behind.
if (wantShots) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--force-device-scale-factor=2",
    "--font-render-hinting=none",
    // GitHub runners cannot use the sandbox.
    ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
  ],
});
const page = await browser.newPage();
// Headless Chrome only paints a caret in a frame it considers focused.
await page.bringToFront();
// Slowing the page down makes render-interleaving bugs deterministic. CI is a
// slower machine than most laptops, so a check that only fails there is often
// reproducible here with THROTTLE=4.
if (process.env.THROTTLE) {
  await page.emulateCPUThrottling(Number(process.env.THROTTLE));
}
await page.setViewport(DESKTOP);
/**
 * Headless runners disagree about whether they have a pointer: CI reports a
 * coarse one where a laptop reports fine, which silently swaps the hover
 * behaviour under test. Say which it is rather than inherit it.
 *
 * Puppeteer only whitelists the `prefers-*` features, so this goes to CDP.
 */
const emulation = await page.createCDPSession();
async function emulatePointer(kind: "fine" | "coarse") {
  await emulation.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "hover", value: kind === "fine" ? "hover" : "none" },
      { name: "pointer", value: kind },
    ],
  });
}
await emulatePointer("fine");

const pageProblems: { step: string; text: string }[] = [];
let currentStep = "startup";
page.on("console", (message) => {
  const text = message.text();
  // Resource 404s are the playground's business, not the component's.
  if (message.type() !== "error") return;
  if (text.startsWith("Failed to load resource")) return;
  pageProblems.push({ step: currentStep, text });
});
page.on("pageerror", (error) => {
  pageProblems.push({ step: currentStep, text: String(error) });
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(EDITOR);
// Transitions do not advance in a headless tab; land on the end state.
await page.addStyleTag({ content: "*{transition:none !important}" });

const context = buildContext(page, wantShots);
const failures: string[] = [];

for (const step of selected) {
  currentStep = step.name;
  const before = pageProblems.length;
  const started = Date.now();
  try {
    // Every step starts from an empty, blurred, committed-clean field, which is
    // what makes any subset runnable on its own.
    await context.setQuery("");
    await context.blur();
    await page.mouse.move(2, 2);
    await context.waitForCommitted("(all records)");

    await step.run(context);

    const raised = pageProblems.slice(before);
    if (raised.length > 0) {
      throw new CheckFailed(`page reported: ${raised[0]!.text.slice(0, 120)}`);
    }
    console.log(`  ok    ${step.name}  ${Date.now() - started}ms`);
  } catch (error) {
    const message =
      error instanceof CheckFailed ? error.message : String(error);
    failures.push(`${step.name}: ${message}`);
    console.log(`  FAIL  ${step.name}  ${Date.now() - started}ms`);
    console.log(`        ${message}`);
  }
}

await browser.close();
stopPlayground();

console.log();
if (failures.length > 0) {
  console.log(`${failures.length} of ${selected.length} steps failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `${selected.length} steps passed${wantShots ? `; screenshots in ${OUT}` : ""}`,
);
