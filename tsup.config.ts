import { defineConfig } from "tsup";

export default defineConfig([
	// Main GitHub Action bundle
	{
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
	},
	// Config test CLI tool
	{
		entry: {
			"config-test": "src/config-test.ts",
		},
		outDir: "bin",
		format: ["cjs"],
		target: "node20",
		clean: true,
		bundle: true,
		minify: false,
		sourcemap: false,
		noExternal: [/.*/],
	},
]);
