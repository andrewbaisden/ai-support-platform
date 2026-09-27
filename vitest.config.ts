import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/ai/**/*.test.ts",
      "packages/widget/**/*.test.tsx",
    ],
  },
});
