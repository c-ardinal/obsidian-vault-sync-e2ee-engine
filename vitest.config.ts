import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            obsidian: "node:path", // Dummy mapping to avoid resolution error
        },
    },
});
