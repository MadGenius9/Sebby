import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.tsx", "component-tests/**/*.spec.tsx"],
    globals: true,
    pool: "threads",
    maxWorkers: 1,
  },
});
