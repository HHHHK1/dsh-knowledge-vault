/**
 * kb_delete: removing a note must (a) take it out of the vault and the index,
 * (b) keep a recoverable copy under .trash, and (c) drop its panel state so the
 * sidebar does not keep pointing at a ghost.
 */
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, "..", "lib", "index.js"), "utf8");
const patched = source.replace(
  'import { defineTool } from "@deepseek-ai/dsh-tools";',
  "const defineTool = (definition) => definition;",
);
if (patched === source) throw new Error("could not stub the defineTool import");

const workDir = await mkdtemp(join(tmpdir(), "kb-delete-"));
const modulePath = join(workDir, "index.local.mjs");
await writeFile(modulePath, patched, "utf8");
const mod = await import(pathToFileURL(modulePath).href);

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

const vault = join(workDir, "vault");
const tools = new Map();
const connectionStub = { requestRejection: () => undefined };
mod.apply(
  {
    tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
    effect: () => () => {},
    logger: { info: () => {}, warn: () => {} },
    inject: (_names, fn) => fn({ webServer: { register: () => () => {} }, get: () => connectionStub }),
    get: () => connectionStub,
  },
  { root: vault },
);
const run = (name, args) => tools.get(name).execute(args, { signal: new AbortController().signal });

check("six tools are registered", tools.size === 6);
check("kb_delete is one of them", tools.has("kb_delete"));

await run("kb_write", { category: "数据库", title: "B-tree 索引为什么快", summary: "把随机读换成分支跳跃。", body: "## 内容\n\n树高压到 3~4 层。" });
await run("kb_write", { category: "数据库", title: "覆盖索引", summary: "查询只用索引就够。", body: "## 内容\n\n不回表。" });

// Pin one entry through the UI route so the prune path has something to drop.
let route = null;
const serverStub = {
  register: (spec) => {
    route = spec;
    return () => {};
  },
};
mod.apply(
  {
    tools: { register: () => () => {} },
    effect: () => () => {},
    logger: { info: () => {}, warn: () => {} },
    inject: (_names, fn) => fn({ webServer: serverStub, get: () => connectionStub }),
    get: () => connectionStub,
  },
  { root: vault },
);

const call = (method, url, body) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: String(payload) });
      },
    };
    const req = {
      method,
      url,
      headers: { host: "127.0.0.1" },
      async *[Symbol.asyncIterator]() {
        if (body) yield Buffer.from(body, "utf8");
      },
    };
    route.handler(req, res);
  });

await call("POST", "/kb/api/ui", JSON.stringify({ pinned: ["数据库/B-tree 索引为什么快.md"], order: { "cat:数据库": ["数据库/B-tree 索引为什么快.md", "数据库/覆盖索引.md"] } }));

const listed = await run("kb_list", {});
check("both entries exist before delete", listed.includes("B-tree 索引为什么快") && listed.includes("覆盖索引"));

const deleted = await run("kb_delete", { title: "b-tree 索引为什么快" });
console.log(deleted);
check("delete reports a trash path", /\.trash\//.test(deleted));
check("delete reports the remaining count", deleted.includes("知识库现有条目: 1"));

const trashFiles = await readdir(join(vault, ".trash"));
check("trash holds one file", trashFiles.length === 1);
check("trash name keeps the original name", trashFiles[0].endsWith("B-tree 索引为什么快.md"));
const recoverable = await readFile(join(vault, ".trash", trashFiles[0]), "utf8");
check("trashed copy still has the body", recoverable.includes("树高压到 3~4 层"));

const after = await run("kb_list", {});
check("deleted entry is gone from the list", !after.includes("B-tree 索引为什么快"));
check("the other entry survived", after.includes("覆盖索引"));

// index.md must have been regenerated without the deleted note
const index = await readFile(join(vault, "index.md"), "utf8");
check("index no longer links the deleted note", !index.includes("B-tree 索引为什么快"));
check("index still links the survivor", index.includes("覆盖索引"));

// panel state: the pin and the manual order must have been pruned
const tree = await call("GET", "/kb/api/tree", null);
const ui = JSON.parse(tree.body).ui;
console.log(JSON.stringify(ui));
check("pin was pruned", !JSON.stringify(ui.pinned).includes("B-tree"));
check("order was pruned", !JSON.stringify(ui.order).includes("B-tree"));

// deleting a missing entry is an error, not a silent success
let refused = false;
try {
  await run("kb_delete", { file: "数据库/不存在.md" });
} catch (err) {
  refused = /ENOENT|no such file|not a file/.test(err.message);
}
check("deleting a missing entry fails loudly", refused);

let traversal = false;
try {
  await run("kb_delete", { file: "../outside.md" });
} catch (err) {
  traversal = /escapes/.test(err.message);
}
check("delete refuses to leave the vault", traversal);

if (failures.length > 0) {
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  console.log("kb_delete behaves");
}
