/**
 * Verify the PUBLISHED artifact, not the source tree.
 *
 *   pnpm pack --pack-destination ../dist
 *   node test/verify-pack.mjs ../dist/dsh-knowledge-vault-0.1.0.tgz
 *
 * 1. lists the tarball (must contain only the `files` whitelist + README/LICENSE)
 * 2. extracts it to a temp dir and loads the host half from there — the same
 *    stub-import trick as smoke.mjs, so a missing dependency surfaces here
 *    instead of in a user's profile
 * 3. loads the client bundle through a fake `window.__ModuleLoader__` and
 *    asserts the two paired slots are registered
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tarball = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node test/verify-pack.mjs <path-to-tgz>");
  process.exit(1);
}

const REQUIRED = [
  "package/package.json",
  "package/lib/index.js",
  "package/lib/client.js",
  "package/cordis.patch.yml",
  "package/dsh-plugin.json",
  "package/README.md",
  "package/LICENSE",
];

const listings = spawnSync("tar", ["-tf", tarball], { encoding: "utf8" });
if (listings.status !== 0) {
  console.error(listings.stderr || "tar -tf failed");
  process.exit(1);
}
const entries = listings.stdout.split(/\r?\n/).filter(Boolean);
console.log(`${basename(tarball)}: ${entries.length} entries`);

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

for (const required of REQUIRED) check(`tarball has ${required}`, entries.includes(required));
for (const forbidden of ["package/test/", "package/assets/", "package/scripts/", "package/node_modules/"]) {
  check(`tarball excludes ${forbidden}`, !entries.some((entry) => entry.startsWith(forbidden)));
}

const workDir = await mkdtemp(join(tmpdir(), "kb-pack-"));
const extract = spawnSync("tar", ["-xzf", tarball, "-C", workDir], { encoding: "utf8" });
if (extract.status !== 0) {
  console.error(extract.stderr || "tar -xzf failed");
  process.exit(1);
}

// ---- host half ----------------------------------------------------------
const hostSource = await readFile(join(workDir, "package", "lib", "index.js"), "utf8");
const patchedHost = hostSource.replace(
  'import { defineTool } from "@deepseek-ai/dsh-tools";',
  "const defineTool = (definition) => definition;",
);
check("host import can be stubbed", patchedHost !== hostSource);
const hostPath = join(workDir, "host.local.mjs");
await (await import("node:fs/promises")).writeFile(hostPath, patchedHost, "utf8");

const host = await import(pathToFileURL(hostPath).href);
check("host exports name", host.name === "dsh-knowledge-vault");
check("host exports inject", Array.isArray(host.inject) && host.inject.includes("tools"));

const tools = new Map();
const routes = [];
const ctx = {
  tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
  effect: () => () => {},
  logger: { info: () => {}, warn: () => {} },
  inject: (names, fn) => {
    // host asks for webServer; hand it a recorder so the /kb/api routes register
    const serverCtx = {
      webServer: {
        register: (route) => (routes.push(route), () => {}),
      },
    };
    fn(serverCtx);
  },
  get: () => undefined,
};
host.apply(ctx, { root: join(workDir, "kb") });

check("host registers 5 tools", tools.size === 5);
for (const name of ["kb_write", "kb_list", "kb_read", "kb_search", "kb_lint"]) {
  check(`host registers ${name}`, tools.has(name));
}

const written = await tools
  .get("kb_write")
  .execute(
    { category: "验证", title: "打包产物可安装", summary: "从 tarball 解出来的宿主半能正常写入。", body: "## 检查\n\n文件落在知识库根目录下。", tags: ["pack"] },
    { signal: new AbortController().signal },
  );
check("host writes from the tarball copy", written.includes("新建: 验证/"));

const routepaths = routes.map((route) => `${route.kind} ${route.path}`);
console.log("routes:", routepaths.join(", ") || "(none)");
check("host registers /kb/api prefix route", routepaths.includes("prefix /kb/api"));

// ---- client half --------------------------------------------------------
const clientSource = await readFile(join(workDir, "package", "lib", "client.js"), "utf8");
let loaded = null;
const reactStub = {
  createElement: (...args) => ({ type: "element", args }),
  Fragment: "Fragment",
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
};
const previousWindow = globalThis.window;
globalThis.window = {
  __ModuleLoader__: { load: (definition) => (loaded = definition) },
};
const clientModule = { exports: {} };
new Function("window", "module", "exports", clientSource)(globalThis.window, clientModule, clientModule.exports);
globalThis.window = previousWindow;

check("client bundle registers with the module loader", loaded?.id === "dsh-knowledge-vault");

const clientExports = loaded.factory((id) => {
  if (id === "react") return reactStub;
  if (id === "@deepseek-ai/dsh-client-ui-primitives") return {};
  throw new Error(`unexpected require: ${id}`);
});
check("client exports inject slots", Array.isArray(clientExports.inject) && clientExports.inject.includes("slots"));

const registered = [];
clientExports.apply({
  slots: {
    inject: (_name, fn) => fn(),
    register: (options, component) => (registered.push({ options, component }), () => {}),
  },
});

const started = () => console.log(`registered: ${registered.map((r) => r.options.name).join(", ")}`);
started();
check("client registers sidebar.panellist", registered.some((r) => r.options.name === "sidebar.panellist" && r.options.id === "dsh-knowledge-vault"));
check("client registers main panel with the same key", registered.some((r) => r.options.name === "main" && r.options.key === "dsh-knowledge-vault"));
check("client components are functions", registered.every((r) => typeof r.component === "function"));

await rm(workDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`FAILURES: ${failures.join(" | ")}`);
  process.exitCode = 1;
} else {
  console.log("packed artifact verified");
}
