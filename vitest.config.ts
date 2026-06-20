import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  // Tests share one SQLite file; run files sequentially so parallel workers
  // don't contend on the single write lock (intermittent "Operation has timed
  // out" on concurrent writes/upserts).
  // unstubEnvs: auto-restore vi.stubEnv() between tests so OIDC_* (and other) env
  // stubs don't leak across the sequential run and flip env-dependent assertions.
  // env.REGISTRATION_ALLOWLIST: registration is fail-closed (lib/registration.ts), so the
  // auth test's @example.com signups must come from an allowed domain. Tests passing their
  // own env to isRegistrationAllowed are unaffected.
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    fileParallelism: false,
    unstubEnvs: true,
    env: { REGISTRATION_ALLOWLIST: "example.com" },
  },
});
