#!/usr/bin/env node
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const minify = !process.argv.includes("--no-minify");
const outFile = resolve(root, "dist/index.html");

const result = await build({
	entryPoints: [resolve(root, "src/main.js")],
	bundle: true,
	minify,
	format: "iife",
	target: "es2020",
	write: false,
	logLevel: "info",
});

const js = result.outputFiles[0].text;
const html = await readFile(resolve(root, "index.html"), "utf8");
const replaced = html.replace(
	/<script\s+type="module"\s+src="[^"]+"\s*><\/script>/,
	`<script>\n${js}\n</script>`,
);
if (replaced === html) {
	console.error("Could not find module script tag in index.html — nothing inlined.");
	process.exit(1);
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, replaced);
console.log(`Wrote ${outFile} (${(replaced.length / 1024).toFixed(1)} KB)`);
