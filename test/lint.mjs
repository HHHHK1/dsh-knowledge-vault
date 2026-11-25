/**
 * Tests for kb_lint, the "did I write this down well" pass.
 *
 * Two fixtures: a deliberately damaged vault that must trip every rule, and a
 * clean one that must come back silent. Both are plain files on disk, so the
 * rules are tested against what kb_write actually produces.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const workDir = await mkdtemp(join(tmpdir(), "kb-lint-"));
const modulePath = join(workDir, "index.local.mjs");
await writeFile(modulePath, patched, "utf8");
const mod = await import(pathToFileURL(modulePath).href);

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

async function boot(root) {
  const tools = new Map();
  mod.apply(
    {
      tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
      effect: () => () => {},
      logger: { info: () => {}, warn: () => {} },
      inject: () => {},
      get: () => undefined,
    },
    { root },
  );
  return (args) => tools.get("kb_lint").execute(args, { signal: new AbortController().signal });
}

function entry(fields, body) {
  const head = ["---"];
  for (const [key, value] of Object.entries(fields)) head.push(`${key}: ${JSON.stringify(value)}`);
  head.push("---", "");
  return `${head.join("\n")}${body}\n`;
}

/* --- a clean vault ------------------------------------------------------- */

const cleanRoot = join(workDir, "clean");
await mkdir(join(cleanRoot, "数据库"), { recursive: true });
await writeFile(
  join(cleanRoot, "数据库", "B-tree.md"),
  entry(
    {
      title: "B-tree 索引为什么快",
      category: "数据库",
      tags: ["postgres", "index"],
      summary: "多路平衡树把树高压到 3~4 层。",
      created: "2026-11-24T02:00:00.000Z",
      updated: "2026-11-24T02:00:00.000Z",
      source_session: "session-a",
    },
    "# B-tree 索引为什么快\n\n## 机制\n\n扇出大，树高低。",
  ),
  "utf8",
);

const lintClean = await boot(cleanRoot);
const cleanOut = await lintClean({});
console.log(cleanOut);
check("clean vault reports nothing", cleanOut.includes("没有发现问题"));

/* --- a damaged vault ----------------------------------------------------- */

const badRoot = join(workDir, "bad");
const bad = [
  ["数据库", "复制粘贴的时间戳 A.md", { created: "2026-11-25T10:12:00.000Z", tags: ["github"] }],
  ["数据库", "复制粘贴的时间戳 B.md", { created: "2026-11-25T10:12:00.000Z", tags: ["github"] }],
  ["工具", "缺 created 的条目.md", { tags: ["github"] }],
  ["工具", "标题写死包名 dsh-foo-bar 的条目.md", { created: "2026-11-25T11:00:00.000Z", tags: ["github"] }],
  ["运维", "跨分类重名.md", { created: "2026-11-25T12:00:00.000Z", tags: ["github"] }],
  ["数据库", "跨分类重名.md", { created: "2026-11-25T13:00:00.000Z", tags: ["github"] }],
];
for (const [category, file, fields] of bad) {
  await mkdir(join(badRoot, category), { recursive: true });
  const full = {
    title: file.replace(/\.md$/, ""),
    category,
    summary: "摘要。",
    updated: "2026-11-25T13:00:00.000Z",
    source_session: "session-b",
    ...fields,
  };
  const body = file.includes("复制粘贴的时间戳 A") ? "# 标题\n\n正文里有坏字符 \uFFFD\uFFFD 两处。" : "# 标题\n\n正文。";
  await writeFile(join(badRoot, category, file), entry(full, body), "utf8");
}

const lintBad = await boot(badRoot);
const badOut = await lintBad({});
console.log(badOut);
check("encoding damage is reported", badOut.includes("U+FFFD"));
check("missing created is reported", badOut.includes("缺 created"));
check("duplicate title is reported", badOut.includes("标题重名"));
check("shared created stamp is reported", badOut.includes("共用同一个 created 时间"));
check("package name in a title is reported", badOut.includes("写死了包名 dsh-foo-bar"));
check("over-broad tag is reported", badOut.includes("起不到筛选作用"));

const toolOut = await lintBad({ category: "工具" });
console.log(toolOut);
check("category filter narrows the scan", toolOut.includes("2 条") && !toolOut.includes("跨分类重名"));

console.log("dir:", workDir);
if (failures.length > 0) {
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  await rm(workDir, { recursive: true, force: true });
  console.log("lint rules hold");
}
