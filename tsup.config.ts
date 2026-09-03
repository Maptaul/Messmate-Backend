import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["api/index.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	bundle: true,
	splitting: false,
	sourcemap: true,

	skipNodeModulesBundle: true,

	banner: {
		js: [
			"import { createRequire } from 'module';",
			"const require = createRequire(import.meta.url);",
		].join("\n"),
	},
});
