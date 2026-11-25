/**
 * Route-level test for the view-state API (`/kb/api/ui`) and the fence.
 *
 * The host half is loaded with a stubbed `@deepseek-ai/dsh-tools` import (same
 * trick as smoke.mjs), a fake `webServer` that captures the prefix handler, and
 * a fake `connection` service so the fence can be driven both ways.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "..", "lib", "index.js");
const source = await readFile(sourcePath, "utf8");
const patched = source.replace(
  'import { defineTool } from "@deepseek-ai/dsh-tools";',
  "const defineTool = (definition) => definition;",
);
if (patched === source) throw new Error("could not stub the defineTool import");

const workDir = await mkdtemp(join(tmpdir(), "kb-ui-"));
const modulePath = join(workDir, "index.local.mjs");
await writeFile(modulePath, patched, "utf8");

const mod = await import(pathToFileURL(modulePath).href);
const root = join(workDir, "kb");
await mkdir(root, { recursive: true });

function makeReq(method, path, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(text) {
      this.body = text ?? "";
    },
    get headersSent() {
      return this.body !== "";
    },
  };
}

function boot(rejection) {
  const routes = [];
  const tools = new Map();
  const ctx = {
    tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
    effect: () => () => {},
    logger: { info: () => {}, warn: () => {} },
    get: (name) => (name === "connection" ? { requestRejection: rejection } : undefined),
    inject: (deps, callback) => {
      if (!deps.includes("webServer")) return;
      callback({ webServer: { register: (route) => (routes.push(route), () => {}) } });
    },
  };
  mod.apply(ctx, { root });
  return { tools, handler: routes[0] ? routes[0].handler : null };
}

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

const allow = () => undefined;
const { tools, handler } = boot(allow);
check("prefix route registered", typeof handler === "function");

const call = async (method, path, body) => {
  const res = makeRes();
  await handler(makeReq(method, path, body), res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
};

// 1. fresh state
const empty = await call("GET", "/kb/api/ui");
check("GET ui on a fresh root", empty.status === 200 && Array.isArray(empty.json.ui.pinned) && empty.json.ui.pinned.length === 0);

// 2. write pins + order + collapsed flag
const saved = await call("POST", "/kb/api/ui", {
  pinned: ["GitHub/a.md"],
  order: { pinned: ["GitHub/a.md"] },
  groups: { "cat:GitHub": true },
});
check("POST ui writes state", saved.status === 200 && saved.json.ui.pinned[0] === "GitHub/a.md");
const onDisk = JSON.parse(await readFile(join(root, ".kb-ui.json"), "utf8"));
check("state file lands inside the knowledge root", onDisk.pinned[0] === "GitHub/a.md" && onDisk.groups["cat:GitHub"] === true);

// 3. partial patch keeps what was not sent
const merged = await call("POST", "/kb/api/ui", { archived: ["npm/b.md"] });
check(
  "partial patch merges",
  merged.json.ui.pinned.length === 1 && merged.json.ui.archived[0] === "npm/b.md" && merged.json.ui.groups["cat:GitHub"] === true,
);

// 4. junk is dropped instead of stored
const junk = await call("POST", "/kb/api/ui", {
  pinned: [1, "", "a.md", "a.md", null],
  groups: { ok: true, bad: "yes" },
  order: { good: ["a.md"], bad: "not-an-array" },
});
check("pins are de-duplicated and coerced", JSON.stringify(junk.json.ui.pinned) === JSON.stringify(["a.md"]));
check("non-boolean group flags dropped", junk.json.ui.groups.bad === undefined && junk.json.ui.groups.ok === true);
check("non-array order dropped", junk.json.ui.order.bad === undefined && junk.json.ui.order.good[0] === "a.md");

// 5. tree carries the view state, and entries never include the state file
await tools.get("kb_write").execute(
  { category: "GitHub", title: "状态文件测试", summary: "s", body: "b" },
  { signal: new AbortController().signal },
);
const tree = await call("GET", "/kb/api/tree");
check("tree returns ui", tree.json.ui && Array.isArray(tree.json.ui.pinned));
check(
  "state file is not listed as an entry",
  tree.json.entries.every((entry) => !entry.file.includes(".kb-ui.json")),
);
const listed = await readdir(root);
check("knowledge root only gained index.md + .kb-ui.json", listed.filter((name) => name.startsWith(".kb-ui")).length === 1);

// 6. an unreadable state file must not break the panel
await writeFile(join(root, ".kb-ui.json"), "{ not json", "utf8");
const broken = await call("GET", "/kb/api/ui");
check("corrupt state file falls back to empty", broken.status === 200 && broken.json.ui.pinned.length === 0);

// 7. fence: a rejected request never reaches the handler body
const denying = () => 403;
const denied = boot(denying);
const deniedRes = makeRes();
await denied.handler(makeReq("GET", "/kb/api/tree"), deniedRes);
check("rejected request answers 403", deniedRes.statusCode === 403 && deniedRes.body.includes("forbidden"));

// 8. and a connection service that throws also fails closed
const throwing = boot(() => {
  throw new Error("boom");
});
const throwingRes = makeRes();
await throwing.handler(makeReq("GET", "/kb/api/tree"), throwingRes);
check("throwing fence fails closed", throwingRes.statusCode === 403);

console.log("root:", root);
if (failures.length > 0) {
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  await rm(workDir, { recursive: true, force: true });
}
