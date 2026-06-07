import { defineConfig } from "@playwright/test";

const PORT = process.env.PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: BASE_URL },
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { DISABLE_RATE_LIMIT: "true", WEBHOOK_ALLOW_INSECURE: "true", OUTBOX_POLL_MS: "500" },
  },
});
