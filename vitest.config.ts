import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    maxWorkers: 2,
    minWorkers: 1,
    testTimeout: 15_000,
  },
});
