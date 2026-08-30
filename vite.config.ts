import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev server runs the playground: `npm run dev` === `vite playground`.
// Vitest keeps the repo root so test globs stay relative to `src/` and
// `playground/`.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "playground/**/*.test.{ts,tsx}"],
  },
});
