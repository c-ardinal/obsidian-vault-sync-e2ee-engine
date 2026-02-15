import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
    input: "src/index.ts",
    output: {
        file: "dist/e2ee-engine.js",
        format: "cjs",
        sourcemap: true,
    },
    external: ["obsidian"],
    plugins: [typescript(), nodeResolve({ browser: true }), commonjs()],
};
