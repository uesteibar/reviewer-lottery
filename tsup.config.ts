import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/main.ts",
	},
	outDir: "dist",
	format: ["cjs"],
	target: "node20",
	clean: true,
	bundle: true,
	minify: true,
	sourcemap: false,
	noExternal: [/.*/],
});
