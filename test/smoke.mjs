/**
 * Smoke test for the host half without a DSH restart.
 *
 * Rewrites the single `@deepseek-ai/dsh-tools` import into a local stub, then
 * drives the registered kb_* tools through a fake cordis context and asserts
 * the Markdown files, the front matter, the dedupe/update path and the index.
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

const workDir = await mkdtemp(join(tmpdir(), "kb-smoke-"));
const modulePath = join(workDir, "index.local.mjs");
await writeFile(modulePath, patched, "utf8");

const mod = await import(pathToFileURL(modulePath).href);
const root = join(workDir, "kb");
await mkdir(root, { recursive: true });

const tools = new Map();
const ctx = {
  tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
  effect: () => () => {},
  logger: { info: () => {}, warn: () => {} },
  inject: () => {},
  get: () => undefined,
};

mod.apply(ctx, { root });

const names = [...tools.keys()].sort();
console.log("tools:", names.join(", "));

const call = (name, args) => tools.get(name).execute(args, { signal: new AbortController().signal });

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

// 1. create two entries
const first = await call("kb_write", {
  category: "数据库",
  title: "B-tree 索引为什么快",
  summary: "多路平衡树把树高压到 3~4 层，一次查询只需少数几次页读取。",
  body: "## 机制\n\n每个节点放多个键，扇出大，树高低。\n\n```sql\nCREATE INDEX idx_a ON t (a);\n```",
  tags: ["postgres", "index"],
  source_session: "session-test",
});
console.log(first);
check("kb_write creates file", first.includes("新建: 数据库/B-tree"));

const second = await call("kb_write", {
  category: "运维",
  title: "Windows 下 pnpm 软链失败",
  summary: "开发者模式未开时 symlink 权限不足，改用 junctions 或开启开发者模式。",
  body: "## 现象\n\nEPERM: operation not permitted, symlink\n\n## 解法\n\n开启 Windows 开发者模式。",
  tags: ["pnpm", "windows"],
});
check("second entry created", second.includes("新建: 运维/"));

// 2. dedupe by title -> append update
const third = await call("kb_write", {
  category: "数据库",
  title: "b-tree 索引为什么快",
  summary: "补充：覆盖索引可以避免回表。",
  body: "## 补充\n\n覆盖索引（index-only scan）避免回表。",
  tags: ["covering-index"],
});
console.log(third);
check(
  "same title appends instead of duplicating",
  third.includes("追加更新") && third.includes("知识库现有条目: 2"),
);

const categoryDir = join(root, "数据库");
const dbFiles = await readdir(categoryDir);
check("only one file for the updated title", dbFiles.length === 1);

const entryText = await readFile(join(categoryDir, dbFiles[0]), "utf8");
check("front matter has title", entryText.startsWith('---\ntitle: "B-tree 索引为什么快"'));
check("update section appended", entryText.includes("## 更新"));
check("tags merged", entryText.includes("covering-index") && entryText.includes("postgres"));
check("created preserved", (entryText.match(/created:/g) || []).length === 1);

// 3. index.md
const indexText = await readFile(join(root, "index.md"), "utf8");
check("index lists both categories", indexText.includes("## 数据库") && indexText.includes("## 运维"));
check("index links the entry", indexText.includes("(./%E6%95%B0%E6%8D%AE%E5%BA%93/") || indexText.includes("B-tree"));

// 4. list / search / read
const list = await call("kb_list", {});
console.log(list);
check("kb_list returns two entries", list.includes("· 2 条"));
check("kb_list category filter", (await call("kb_list", { category: "运维" })).includes("· 1 条"));

const search = await call("kb_search", { query: "覆盖索引" });
console.log(search);
check("kb_search finds body text", search.includes("命中 1 条"));

const read = await call("kb_read", { title: "Windows 下 pnpm 软链失败" });
check("kb_read by title", read.includes("EPERM"));

// 5. path escape guard
let escaped = false;
try {
  await call("kb_read", { file: "../../windows/win.ini" });
} catch (error) {
  escaped = /escapes the knowledge root/.test(String(error.message));
}
check("path escape rejected", escaped);

console.log("root:", root);
if (failures.length > 0) {
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  await rm(workDir, { recursive: true, force: true });
}
