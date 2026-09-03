import { defineConfig } from "tsup";

/**
 * Bundles the serverless entry into one self-contained file.
 *
 * This is not an optimisation, it is the only thing that makes the project run
 * on plain Node. The repo is ESM with `moduleResolution: "bundler"`, so both our
 * own code and Prisma's generated client import each other without file
 * extensions - which TypeScript allows and Node's ESM loader refuses
 * ("ERR_UNSUPPORTED_DIR_IMPORT"). `tsx` papers over it locally; Vercel runs
 * plain Node and does not.
 *
 * Hand-adding extensions would not fix it either: the generated Prisma client
 * has 54 extensionless imports of its own and is rewritten by every
 * `prisma generate`. Bundling resolves all of it at build time instead, so
 * nothing is left to resolve at runtime.
 */
export default defineConfig({
	entry: ["api/index.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	bundle: true,
	splitting: false,
	sourcemap: true,
	// Dependencies stay external and are resolved from node_modules as bare
	// specifiers, which Node handles fine. Only relative imports - ours and the
	// generated client's - get inlined, and those are the broken ones.
	skipNodeModulesBundle: true,
	// Some dependencies are CommonJS and call require() internally. In an ESM
	// output that identifier does not exist, so it is recreated here.
	banner: {
		js: [
			"import { createRequire } from 'module';",
			"const require = createRequire(import.meta.url);",
		].join("\n"),
	},
});
