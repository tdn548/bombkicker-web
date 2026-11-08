/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site is served from the GitHub Pages project path https://tdn548.github.io/bombkicker-web/ (D10).
// Keep the same path locally so Unity's PlayerPrefs folder (md5 of the page URL) matches the old site (SS-1).
export default defineConfig({
  base: "/bombkicker-web/",
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  preview: { port: 8000, strictPort: false },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
});
