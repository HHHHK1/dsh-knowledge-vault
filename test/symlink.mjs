/**
 * Symlink containment: a link inside the vault may point anywhere on the disk,
 * and its path never contains "..". Everything that reads or writes the vault
 * must check the *real* path, not just the string prefix.
 *
 * On Windows a file symlink needs Developer Mode or an elevated shell, but a
 * directory *junction* does not — so the directory case is always exercised.
 * Any kind that the OS refuses is reported as SKIP, not as a failure.
 */
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
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

const workDir = await mkdtemp(join(tmpdir(), "kb-symlink-"));
const modulePath = join(workDir, "index.local.mjs");
await writeFile(modulePath, patched, "utf8");
const mod = await import(pathToFileURL(modulePath).href);

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};
const skip = (label, why) => console.log(`SKIP ${label} — ${why}`);

const vault = join(workDir, "vault");
const outside = join(workDir, "outside");
await mkdir(vault, { recursive: true });
await mkdir(outside, { recursive: true });
await writeFile(join(outside, "secret.md"), '---\ntitle: "外面的秘密"\n---\n\n# 外面的秘密\n\n不该被读到。\n', "utf8");

let fileLink = false;
let dirLink = false;
try {
  await symlink(join(outside, "secret.md"), join(vault, "偷看.md"));
  fileLink = true;
} catch (err) {
  skip("file symlink", err.code);
}
try {
  await symlink(outside, join(vault, "外链"), process.platform === "win32" ? "junction" : "dir");
  dirLink = true;
} catch (err) {
  skip("directory link", err.code);
}
check("at least one kind of link could be created", fileLink || dirLink);

const links = await readlink(join(vault, fileLink ? "偷看.md" : "外链"));
check("link resolves on disk", typeof links === "string" && links.length > 0);

const tools = new Map();
let route = null;
const serverStub = {
  register: (spec) => {
    route = spec;
    return () => {};
  },
};
const connectionStub = { requestRejection: () => undefined };
mod.apply(
  {
    tools: { register: (tool) => (tools.set(tool.name, tool), () => {}) },
    effect: () => () => {},
    logger: { info: () => {}, warn: () => {} },
    inject: (_names, fn) => fn({ webServer: serverStub, get: (key) => (key === "connection" ? connectionStub : undefined) }),
    get: (key) => (key === "connection" ? connectionStub : undefined),
  },
  { root: vault },
);
const run = (name, args) => tools.get(name).execute(args, { signal: new AbortController().signal });

await run("kb_write", { category: "正常", title: "真正的条目", summary: "库内的。", body: "## 内容\n\n库内正文。" });

const listed = await run("kb_list", {});
console.log(listed);
check("list shows the real entry", listed.includes("真正的条目"));
check("list hides the linked file", !listed.includes("偷看"));
check("list hides the linked directory", !listed.includes("外链"));

if (fileLink) {
  let refused = false;
  try {
    await run("kb_read", { file: "偷看.md" });
  } catch (err) {
    refused = /symlink|escapes/.test(err.message);
  }
  check("kb_read refuses the linked file", refused);
}

if (dirLink) {
  let refused = false;
  try {
    await run("kb_read", { file: "外链/secret.md" });
  } catch (err) {
    refused = /symlink|escapes/.test(err.message);
  }
  check("kb_read refuses a file inside the linked directory", refused);

  let writeRefused = false;
  try {
    await run("kb_write", { category: "外链", title: "越界写入", summary: "不该落地。", body: "## 内容\n\n不该落地。" });
  } catch (err) {
    writeRefused = /symlink|escapes/.test(err.message);
  }
  check("kb_write refuses the linked directory", writeRefused);

  let leaked = false;
  try {
    await readFile(join(outside, "越界写入.md"), "utf8");
    leaked = true;
  } catch {
    leaked = false;
  }
  check("nothing was written outside the vault", !leaked);
}

const request = (url) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(body) {
        resolve({ status: this.statusCode, body: String(body) });
      },
    };
    route.handler({ method: "GET", url, headers: { host: "127.0.0.1" } }, res);
  });

const target = fileLink ? "偷看.md" : "外链/secret.md";
const payload = await request("/kb/api/read?file=" + encodeURIComponent(target));
console.log(payload.status, payload.body.slice(0, 160));
check("GET /kb/api/read refuses the link", payload.status === 403 && !payload.body.includes("外面的秘密"));

const tree = await request("/kb/api/tree");
check("GET /kb/api/tree hides the link", !tree.body.includes("偷看") && !tree.body.includes("外链"));

if (failures.length > 0) {
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  await rm(workDir, { recursive: true, force: true });
  console.log("symlink containment holds");
}
