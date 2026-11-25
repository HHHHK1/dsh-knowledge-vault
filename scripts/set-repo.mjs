#!/usr/bin/env node
/**
 * Backfill the repository metadata once the GitHub repo exists.
 *
 *   node scripts/set-repo.mjs https://github.com/<owner>/dsh-knowledge-vault
 *
 * Writes `repository`, `homepage` and `bugs` into package.json (keeping key
 * order stable by rebuilding the object) and prints the exact values the two
 * plugin markets ask for. Run it from anywhere; paths are resolved relative to
 * this file.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");

const raw = process.argv[2] ?? "";
const url = raw.trim().replace(/\.git$/, "").replace(/\/+$/, "");

if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) {
  console.error("usage: node scripts/set-repo.mjs https://github.com/<owner>/<repo>");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const owner = url.split("/")[3];

pkg.repository = { type: "git", url: `${url}.git` };
pkg.homepage = `${url}#readme`;
pkg.bugs = { url: `${url}/issues` };
if (!pkg.author || typeof pkg.author !== "object") {
  pkg.author = { name: typeof pkg.author === "string" ? pkg.author : owner, url: `https://github.com/${owner}` };
}

// keep a readable key order
const order = [
  "name", "version", "description", "type", "main", "exports", "files",
  "keywords", "author", "license", "repository", "homepage", "bugs",
  "engines", "dsh", "peerDependencies", "peerDependenciesMeta", "publishConfig",
];
const rebuilt = {};
for (const key of order) if (key in pkg) rebuilt[key] = pkg[key];
for (const key of Object.keys(pkg)) if (!(key in rebuilt)) rebuilt[key] = pkg[key];

await writeFile(pkgPath, `${JSON.stringify(rebuilt, null, 2)}\n`, "utf8");

const icon = `https://raw.githubusercontent.com${url.replace("https://github.com", "")}/main/assets/icon-180.png`;

console.log("package.json updated:\n");
console.log(`  repository: ${rebuilt.repository.url}`);
console.log(`  homepage:   ${rebuilt.homepage}`);
console.log(`  bugs:       ${rebuilt.bugs.url}`);
console.log("\nvalues the markets want:\n");
console.log(`  repo:        ${url}`);
console.log(`  npm:         https://www.npmjs.com/package/${pkg.name}`);
console.log(`  icon (raw):  ${icon}`);
console.log(`  awesome yml: data/plugins/${owner}__${pkg.name}.yml`);
