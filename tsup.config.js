const { defineConfig } = require("tsup");

module.exports = defineConfig({
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
