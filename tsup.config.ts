import { copyFile, mkdir } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react"],
  // Shipped as plain stylesheets rather than Tailwind classes, so consumers
  // need no matching config. `layout.css` is required, `theme.css` is opt-in,
  // and `styles.css` imports both for the easy path.
  async onSuccess() {
    await mkdir("dist", { recursive: true });
    for (const file of ["layout.css", "theme.css", "styles.css"]) {
      await copyFile(`src/react/${file}`, `dist/${file}`);
    }
  },
});
