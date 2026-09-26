import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup-env.ts"],
    server: {
      deps: {
        inline: ["@google/generative-ai"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*"],
      exclude: [
        "src/**/*.d.ts",
        "src/lib/db/migrations/**",
        "src/lib/db/nordic-migrations/**",
        "src/lib/db/index.ts",
        "src/components/ui/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
