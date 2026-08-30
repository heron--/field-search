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
  // Shipped as plain stylesheets rather than runtime-injected CSS. `base.css`
  // is structural, `theme.css` is optional, and `styles.css` imports both.
  async onSuccess() {
    await mkdir("dist", { recursive: true });
    for (const file of ["base.css", "layout.css", "theme.css", "styles.css"]) {
      await copyFile(`src/react/${file}`, `dist/${file}`);
    }
  },
});
