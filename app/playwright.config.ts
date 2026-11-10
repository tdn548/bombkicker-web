import { defineConfig, devices } from "@playwright/test";

// Two suites:
// - mock (default): the site built with the mock API and mock Unity (`vite build --mode mock`), no other services.
// - real (BK_E2E_REAL=1): the normal build with the Unity WebGL build in public/game, against a local bombkicker-api on
//   :8787 (Unity's ApiConfig uses <page host>:8787 for local pages) and, for quick match, a local dedicated server.
//   See README.md "Real suite setup".
const real = process.env.BK_E2E_REAL === "1";
const MOCK_PORT = 8011;
const REAL_PORT = Number(process.env.BK_E2E_PORT ?? 8010);

export default defineConfig({
  testDir: "e2e",
  timeout: real ? 240_000 : 60_000,
  expect: { timeout: real ? 60_000 : 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: real
    ? [
        { name: "real-chromium", testMatch: /real\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${REAL_PORT}/bombkicker-web/` } },
        { name: "real-webkit", testMatch: /real\.spec\.ts/, use: { ...devices["Desktop Safari"], baseURL: `http://localhost:${REAL_PORT}/bombkicker-web/` } },
        // SS-14: shop flows on the phone layout (the Unity tests skip themselves outside Chromium); room code input (relay-rooms)
        { name: "real-iphone-webkit", testMatch: /(shop|room-code-input)\.real\.spec\.ts/, use: { ...devices["iPhone 15"], baseURL: `http://localhost:${REAL_PORT}/bombkicker-web/` } },
      ]
    : [
        { name: "mock-desktop-chromium", testMatch: /mock\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${MOCK_PORT}/bombkicker-web/` } },
        { name: "mock-desktop-webkit", testMatch: /mock\.spec\.ts/, use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${MOCK_PORT}/bombkicker-web/` } },
        { name: "mock-iphone-webkit", testMatch: /mock\.spec\.ts/, use: { ...devices["iPhone 15"], baseURL: `http://localhost:${MOCK_PORT}/bombkicker-web/` } },
      ],
  webServer: real
    ? { command: `npx vite preview --port ${REAL_PORT} --strictPort`, url: `http://localhost:${REAL_PORT}/bombkicker-web/`, reuseExistingServer: true, timeout: 60_000 }
    : {
        command: `npx vite build --mode mock --outDir dist-mock && npx vite preview --outDir dist-mock --port ${MOCK_PORT} --strictPort`,
        url: `http://localhost:${MOCK_PORT}/bombkicker-web/`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
