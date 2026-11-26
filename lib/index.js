/**
 * dsh-knowledge-vault — host half.
 *
 * A conversation-driven personal knowledge base: the model calls `kb_write`
 * after a discussion, and each technical point lands as one plain Markdown
 * file (YAML-ish front matter) inside a user-chosen directory. The directory
 * index (`index.md`) is regenerated after every write so the whole library
 * stays greppable by a human, by Git, or by Obsidian.
 *
 * The same directory is served to the browser half under `/kb/api/*`, which
 * powers the read-only left-sidebar browser panel. Edits flow through the
 * tools only — the panel never writes.
 *
 * @module dsh-knowledge-vault
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const PLUGIN_ID = "dsh-knowledge-vault";
const API_PREFIX = "/kb/api";
const UPDATE_HEADING = "更新";

export const name = PLUGIN_ID;
export const inject = ["tools"];

/* ------------------------------------------------------------------ */
/* paths                                                               */
/* ------------------------------------------------------------------ */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function stateRoot() {
  return join(dshHome(), "kb-plugin");
}

function settingsPath() {
  return join(stateRoot(), "settings.json");
}

/** `<DSH_HOME>/../kb` — beside the DSH data directory, not inside the workspace. */
function fallbackRoot() {
  return resolve(dshHome(), "..", "kb");
}

async function readSettings() {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSettings(patch) {
  await mkdir(stateRoot(), { recursive: true });
  const next = { ...(await readSettings()), ...patch, updatedAt: new Date().toISOString() };
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function effectiveRoot(config, settings) {
  const fromSettings = typeof settings?.root === "string" ? settings.root.trim() : "";
  const fromConfig = typeof config?.root === "string" ? config.root.trim() : "";
  return resolve(fromSettings || fromConfig || fallbackRoot());
}

async function ensureRoot(root) {
  await mkdir(root, { recursive: true });
  return root;
}

/* ------------------------------------------------------------------ */
/* view state — `.kb-ui.json` inside the knowledge root                */
/* ------------------------------------------------------------------ */

/**
 * Pins, archived entries, per-group ordering and collapsed groups live in one
 * small file inside the knowledge root. Keeping it separate means the Markdown
 * stays pure content (Obsidian / git see nothing but prose), and moving the
 * root carries the view state along with the notes.
 */
const UI_FILE = ".kb-ui.json";
const UI_MAX_LIST = 5000;

function uiPath(root) {
  return join(root, UI_FILE);
}

function emptyUi() {
  return { version: 1, pinned: [], archived: [], groups: {}, order: {}, sort: "manual" };
}

function cleanKey(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function cleanFileList(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const key = cleanKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= UI_MAX_LIST) break;
  }
  return out;
}

/** Keep only the shapes the panel understands, so a hand-edited file cannot crash it. */
function sanitizeUi(raw) {
  const ui = emptyUi();
  if (!raw || typeof raw !== "object") return ui;

  const pinned = cleanFileList(raw.pinned);
  if (pinned) ui.pinned = pinned;
  const archived = cleanFileList(raw.archived);
  if (archived) ui.archived = archived;
  if (raw.sort === "recent" || raw.sort === "manual") ui.sort = raw.sort;

  const groups = raw.groups;
  if (groups && typeof groups === "object") {
    for (const [key, value] of Object.entries(groups)) {
      const groupKey = cleanKey(key);
      if (!groupKey || typeof value !== "boolean") continue;
      ui.groups[groupKey] = value;
    }
  }

  const order = raw.order;
  if (order && typeof order === "object") {
    for (const [key, value] of Object.entries(order)) {
      const groupKey = cleanKey(key);
      if (!groupKey) continue;
      const list = cleanFileList(value);
      if (list) ui.order[groupKey] = list;
    }
  }

  return ui;
}

async function readUi(root) {
  try {
    const raw = await readFile(uiPath(root), "utf8");
    return sanitizeUi(JSON.parse(raw));
  } catch {
    return emptyUi();
  }
}

async function writeUi(root, ui) {
  const next = sanitizeUi(ui);
  await ensureRoot(root);
  const target = uiPath(root);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
  await rename(temp, target);
  return next;
}

/**
 * Drop UI keys that point at entries which no longer exist. Without this the
 * panel keeps a growing list of ghosts: pinned/archived files that were
 * deleted, and order arrays full of missing names.
 */
function pruneUi(ui, files) {
  const keep = (list) => list.filter((file) => files.has(file));
  const next = {
    ...ui,
    pinned: keep(ui.pinned),
    archived: keep(ui.archived),
    order: {},
  };
  for (const [key, list] of Object.entries(ui.order)) {
    const survivors = keep(list);
    if (survivors.length > 0) next.order[key] = survivors;
  }
  const changed = JSON.stringify(sanitizeUi(ui)) !== JSON.stringify(next);
  return { ui: next, changed };
}

/* ------------------------------------------------------------------ */
/* markdown files                                                      */
/* ------------------------------------------------------------------ */

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

function safeSegment(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function buildFrontMatter(fields) {
  const lines = ["---"];
  for (const key of ["title", "category", "tags", "summary", "created", "updated", "source_session"]) {
    const value = fields[key];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function parseFrontMatter(text) {
  if (typeof text !== "string" || !text.startsWith("---")) return { data: {}, body: text ?? "" };
  const endIdx = text.indexOf("\n---", 3);
  if (endIdx === -1) return { data: {}, body: text };
  const head = text.slice(3, endIdx).split("\n");
  const body = text.slice(endIdx + 4).replace(/^\r?\n/, "");
  const data = {};
  for (const line of head) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

function toPosix(rel) {
  return rel.split(sep).join("/");
}

function fromPosix(rel) {
  return rel.split("/").join(sep);
}

/** Refuse any relative path that escapes the knowledge root. */
function resolveInside(root, rel) {
  const target = resolve(root, fromPosix(rel));
  const guard = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(guard)) {
    throw new Error(`path escapes the knowledge root: ${rel}`);
  }
  return target;
}

/**
 * The string check in resolveInside cannot see through symlinks: a link inside
 * the vault may point at C:\Windows, and `..` never appears in its path. So the
 * real path of the target - or of its nearest existing ancestor, for a file
 * that is about to be created - must still be inside the real root.
 */
async function resolveInsideReal(root, rel) {
  const target = resolveInside(root, rel);
  const base = await realRoot(root);
  const guard = base.endsWith(sep) ? base : base + sep;
  let probe = target;
  for (;;) {
    let real = null;
    try {
      real = await realpath(probe);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    if (real) {
      if (real !== base && !real.startsWith(guard)) {
        throw new Error(`path escapes the knowledge root through a symlink: ${rel}`);
      }
      return target;
    }
    const parent = dirname(probe);
    if (parent === probe) throw new Error(`path escapes the knowledge root: ${rel}`);
    probe = parent;
  }
}

async function realRoot(root) {
  try {
    return await realpath(root);
  } catch {
    return resolve(root);
  }
}

function oneLine(text, max = 200) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function describeEntry(root, rel) {
  try {
    const full = await resolveInsideReal(root, rel);
    // lstat: a symlink is not an entry of this vault, even if it points at a
    // Markdown file that is.
    const info = await lstat(full);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const text = await readFile(full, "utf8");
    const { data } = parseFrontMatter(text);
    const segments = rel.split("/");
    const category = segments.length > 1 ? segments[0] : "";
    const fileTitle = segments[segments.length - 1].replace(/\.md$/i, "");
    return {
      file: rel,
      category: typeof data.category === "string" && data.category ? data.category : category,
      title: typeof data.title === "string" && data.title ? data.title : fileTitle,
      tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
      summary: typeof data.summary === "string" ? data.summary : "",
      created: typeof data.created === "string" ? data.created : null,
      updated: typeof data.updated === "string" ? data.updated : new Date(info.mtimeMs).toISOString(),
      source_session: typeof data.source_session === "string" ? data.source_session : null,
      bytes: info.size,
    };
  } catch {
    return null;
  }
}

async function listEntries(root) {
  await ensureRoot(root);
  const entries = [];
  const top = await readdir(root, { withFileTypes: true });
  for (const dir of top) {
    if (dir.name.startsWith(".") || dir.name === "index.md") continue;
    // Never walk through a link: it may point anywhere on the disk.
    if (dir.isSymbolicLink()) continue;
    if (dir.isDirectory()) {
      const children = await readdir(join(root, dir.name), { withFileTypes: true });
      for (const child of children) {
        if (child.isSymbolicLink() || !child.isFile() || !child.name.toLowerCase().endsWith(".md")) continue;
        const described = await describeEntry(root, `${dir.name}/${child.name}`);
        if (described) entries.push(described);
      }
    } else if (dir.isFile() && dir.name.toLowerCase().endsWith(".md")) {
      const described = await describeEntry(root, dir.name);
      if (described) entries.push(described);
    }
  }
  entries.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category, "zh");
    return String(b.updated).localeCompare(String(a.updated));
  });
  return entries;
}

function indexMarkdown(entries) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const lines = ["# 知识库索引", "", `共 ${entries.length} 条 · 索引更新 ${stamp}`, ""];
  if (entries.length === 0) {
    lines.push("_还没有条目。在对话里说「把这次讨论总结到知识库」，条目会出现在这里。_", "");
    return lines.join("\n");
  }
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.category || "未分类";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b, "zh"))) {
    lines.push(`## ${key}`, "");
    for (const entry of groups.get(key)) {
      const summary = entry.summary ? ` — ${oneLine(entry.summary, 120)}` : "";
      const tags = entry.tags.length ? ` \`${entry.tags.join("` `")}\`` : "";
      lines.push(`- [${entry.title}](./${encodeURI(entry.file)})${summary}${tags}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function rebuildIndex(root) {
  const entries = await listEntries(root);
  await writeFile(join(root, "index.md"), indexMarkdown(entries), "utf8");
  return entries;
}

function mergeTags(existing, incoming) {
  const out = [];
  for (const tag of [...(existing ?? []), ...(incoming ?? [])]) {
    const value = String(tag).trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

async function writeEntry(root, input) {
  await ensureRoot(root);
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const body = String(input.body ?? "").trim();
  if (!body) throw new Error("body is required");

  const entries = await listEntries(root);
  const wanted = title.toLowerCase();
  const existing = entries.find((entry) => entry.title.toLowerCase() === wanted);
  // Keep the established casing/filename when a point is updated: the title is
  // the dedupe key, and re-casing it would leave a stale index entry behind.
  const storedTitle = existing?.title ?? title;

  const now = new Date().toISOString();
  const category = safeSegment(input.category || existing?.category || "未分类", "未分类");
  const rel = existing ? existing.file : toPosix(join(category, `${safeSegment(storedTitle, "untitled")}.md`));
  const full = await resolveInsideReal(root, rel);
  await mkdir(dirname(full), { recursive: true });

  const tags = mergeTags(existing?.tags, input.tags);
  const summary = String(input.summary ?? "").trim() || existing?.summary || "";
  const sourceSession = String(input.source_session ?? "").trim() || undefined;

  let created = existing?.created ?? now;
  let previousBody = "";
  if (existsSync(full)) {
    const previous = parseFrontMatter(await readFile(full, "utf8"));
    previousBody = previous.body.trim();
    if (typeof previous.data.created === "string" && previous.data.created) created = previous.data.created;
  }

  const nextBody = previousBody ? `${previousBody}\n\n## ${UPDATE_HEADING} ${now.slice(0, 10)}\n\n${body}` : `# ${storedTitle}\n\n${summary ? `> ${summary}\n\n` : ""}${body}`;
  const front = buildFrontMatter({
    title: storedTitle,
    category,
    tags,
    summary,
    created,
    updated: now,
    source_session: sourceSession ?? existing?.source_session,
  });
  await writeFile(full, `${front}${nextBody}\n`, "utf8");
  const all = await rebuildIndex(root);
  return { file: rel, title: storedTitle, category, action: previousBody ? "updated" : "created", total: all.length };
}

async function readEntry(root, rel) {
  const target = await resolveInsideReal(root, rel);
  const text = await readFile(target, "utf8");
  const parsed = parseFrontMatter(text);
  return { file: toPosix(rel), text, data: parsed.data, body: parsed.body };
}

function searchEntries(entries, contents, query, limit) {
  const needle = query.toLowerCase();
  const scored = [];
  for (const entry of entries) {
    const content = (contents.get(entry.file) ?? "").toLowerCase();
    let score = 0;
    if (entry.title.toLowerCase().includes(needle)) score += 10;
    if (entry.tags.some((tag) => tag.toLowerCase().includes(needle))) score += 6;
    if (entry.summary.toLowerCase().includes(needle)) score += 4;
    if (content.includes(needle)) score += 2;
    if (score > 0) scored.push({ entry, score, content });
  }
  scored.sort((a, b) => b.score - a.score || String(b.entry.updated).localeCompare(String(a.entry.updated)));
  return scored.slice(0, limit).map(({ entry, content }) => {
    const idx = content.toLowerCase().indexOf(needle);
    const snippet = idx === -1 ? entry.summary : oneLine(content.slice(Math.max(0, idx - 60), idx + 120), 180);
    return { ...entry, snippet };
  });
}

/* ------------------------------------------------------------------ */
/* delete (soft: the note goes to <root>/.trash, never away)           */
/* ------------------------------------------------------------------ */

const TRASH_DIR = ".trash";

/** Strip the differences humans do not mean: case, spacing, punctuation. */
function normalizeTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\\/:*?"<>|`'’“”()（）[\]{}.,;!?~-]/g, "");
}

function trashStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Move one entry out of the vault into `<root>/.trash/`, then rebuild the
 * index and drop its UI keys. Deleting is the one operation a reader asks for
 * most and a read-only panel cannot do, so it is a tool — but a recovery path
 * matters more than a tidy `unlink`: the file is renamed, not removed.
 */
async function deleteEntry(root, rel) {
  const target = await resolveInsideReal(root, rel);
  const info = await lstat(target);
  if (!info.isFile()) throw new Error(`not a file: ${rel}`);
  const trash = join(root, TRASH_DIR);
  await mkdir(trash, { recursive: true });
  const base = toPosix(rel).split("/").pop();
  let name = `${trashStamp(new Date())}-${base}`;
  let counter = 1;
  for (;;) {
    try {
      await lstat(join(trash, name));
      counter += 1;
      name = `${trashStamp(new Date())}-${counter}-${base}`;
    } catch {
      break;
    }
  }
  await rename(target, join(trash, name));
  const remaining = await rebuildIndex(root);
  const ui = await readUi(root);
  const files = new Set(remaining.map((entry) => entry.file));
  const pruned = pruneUi(ui, files);
  if (pruned.changed) await writeUi(root, pruned.ui);
  return { file: toPosix(rel), trashedTo: `${TRASH_DIR}/${name}`, total: remaining.length };
}


/* ------------------------------------------------------------------ */
/* lint (the "did I write this down well" pass)                        */
/* ------------------------------------------------------------------ */

const REPLACEMENT_CHAR = "\uFFFD";
const BRAND_IN_TITLE = /\bdsh-[a-z0-9]+(?:-[a-z0-9]+)*\b/;
const BROAD_TAG_RATIO = 0.4;
const BROAD_TAG_MIN_ENTRIES = 5;

/**
 * Check the entries for the failure modes that make a knowledge base decay:
 * encoding damage, half-filled front matter, a dedupe key that is not unique,
 * timestamps that were copy-pasted, and tags too broad to filter anything.
 *
 * Pure: takes what listEntries/readFile already produced, touches no disk.
 */
function lintEntries(entries, bodies) {
  const problems = [];
  const notices = [];

  for (const entry of entries) {
    const body = bodies.get(entry.file) ?? "";
    const damaged = body.split(REPLACEMENT_CHAR).length - 1;
    if (damaged > 0) {
      problems.push(`${entry.file}: 正文含 ${damaged} 个 U+FFFD 替换字符（编码损坏，需要按行重写）`);
    }
    if (!entry.created) problems.push(`${entry.file}: front-matter 缺 created`);
    if (!entry.summary) problems.push(`${entry.file}: front-matter 缺 summary`);
    if (!entry.source_session) {
      notices.push(`${entry.file}: 缺 source_session，无法回溯是哪次对话的结论`);
    }
  }

  // One title = one file is the dedupe contract, so a duplicate across
  // categories means the next kb_write will silently fold two notes together.
  const byTitle = new Map();
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), entry]);
  }
  for (const [, group] of byTitle) {
    if (group.length > 1) {
      problems.push(`标题重名（会被 kb_write 合并成同一条）: ${group.map((entry) => entry.file).join(" | ")}`);
    }
  }

  // Near duplicates: "B树索引" and "B 树 索引" are the same point written
  // twice, and kb_write's exact-title dedupe happily keeps both files.
  const byNormalized = new Map();
  for (const entry of entries) {
    const key = normalizeTitle(entry.title);
    if (!key) continue;
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), entry]);
  }
  for (const [, group] of byNormalized) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((entry) => entry.title.trim().toLowerCase()));
    if (distinct.size === 1) continue; // exact duplicates are reported above
    notices.push(`近似重名，可能是同一个点写了两遍: ${group.map((entry) => entry.file).join(" | ")}`);
  }


  // Copy-pasted created stamps: every note claims the same birth second, so
  // "when did I learn this" and "what is stale" stop being answerable.
  const byCreated = new Map();
  for (const entry of entries) {
    if (!entry.created) continue;
    byCreated.set(entry.created, [...(byCreated.get(entry.created) ?? []), entry.file]);
  }
  for (const [stamp, files] of byCreated) {
    if (files.length > 1) {
      notices.push(`${files.length} 条共用同一个 created 时间 ${stamp}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? " …" : ""}`);
    }
  }

  // A tag on half the vault filters nothing.
  if (entries.length >= BROAD_TAG_MIN_ENTRIES) {
    const counts = new Map();
    for (const entry of entries) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const [tag, count] of counts) {
      if (count / entries.length > BROAD_TAG_RATIO) {
        notices.push(`标签「${tag}」覆盖 ${count}/${entries.length} 条，起不到筛选作用`);
      }
    }
  }

  // A title that names a package goes stale the moment it is renamed.
  for (const entry of entries) {
    const hit = entry.title.match(BRAND_IN_TITLE);
    if (hit) notices.push(`${entry.file}: 标题里写死了包名 ${hit[0]}，改名后这条就会过时`);
  }

  return { problems, notices };
}

function renderLint(root, entries, result) {
  const lines = [`知识库体检 · ${entries.length} 条 · 根目录: ${root}`, ""];
  if (entries.length === 0) {
    lines.push("_知识库是空的，没有可体检的条目。_");
    return lines.join("\n");
  }
  if (result.problems.length === 0 && result.notices.length === 0) {
    lines.push("没有发现问题。");
    return lines.join("\n");
  }
  lines.push(`${result.problems.length} 个问题 · ${result.notices.length} 条提醒`);
  if (result.problems.length > 0) {
    lines.push("", "## 问题");
    for (const item of result.problems) lines.push(`- ${item}`);
  }
  if (result.notices.length > 0) {
    lines.push("", "## 提醒");
    for (const item of result.notices) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* text helpers shared with the panel                                  */
/* ------------------------------------------------------------------ */

function formatEntryLine(entry) {
  const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
  const summary = entry.summary ? ` — ${oneLine(entry.summary, 100)}` : "";
  return `- ${entry.category || "未分类"} / ${entry.title}${tags}${summary} (${entry.file})`;
}

/* ------------------------------------------------------------------ */
/* plugin body                                                         */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const log = (level, message) => {
    const logger = ctx.logger;
    if (!logger) return;
    if (typeof logger[level] === "function") logger[level](`${PLUGIN_ID}: ${message}`);
  };

  const rootFor = async () => effectiveRoot(config, await readSettings());

  const textOutput = (label) => ({
    schema: { type: "string" },
    render: (_args, value) => [{ type: "text", text: String(value ?? "") }],
  });

  const register = (tool) => {
    const dispose = ctx.tools.register(tool);
    ctx.effect?.(() => dispose, `${PLUGIN_ID}: tool ${tool.name}`);
  };

  register(
    defineTool({
      name: "kb_write",
      description:
        "Save one distilled technical point into the user's personal Markdown knowledge base. Call this when the user asks to summarize the discussion into the knowledge base (e.g. 「把这次讨论总结到知识库」). One call = one technical point: split the discussion into points and call once per point. Reusable knowledge only (concepts, mechanisms, conclusions, pitfalls, commands, configs) — never chat pleasantries or one-off task state. When a point with the same title already exists, the new text is appended under an '## 更新 <date>' heading and the tags are merged instead of creating a duplicate file.",
      parameters: {
        category: { type: "string", required: true, description: "Knowledge category / directory, e.g. 数据库, 前端, 运维, 网络" },
        title: { type: "string", required: true, description: "Concise technical point title; also the file name and the dedupe key" },
        summary: { type: "string", required: true, description: "One sentence: what this point lets the reader do or understand" },
        body: { type: "string", required: true, description: "Markdown body. Use '## 小节' headings, fenced code blocks for commands/config, and bullet lists for steps. Self-contained: no 'as discussed above'." },
        tags: { type: "array", items: { type: "string" }, description: "Optional lowercase tags for retrieval, e.g. ['postgres','index']" },
        source_session: { type: "string", description: "Optional originating session id, for traceability" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        const result = await writeEntry(root, args);
        const verb = result.action === "created" ? "新建" : "追加更新";
        return [
          `— ${verb}: ${result.file}`,
          `标题: ${result.title}`,
          `分类: ${result.category}`,
          `知识库现有条目: ${result.total}`,
          `根目录: ${root}`,
        ].join("\n");
      },
    }),
  );

  register(
    defineTool({
      name: "kb_list",
      description:
        "List entries in the user's knowledge base, optionally filtered to one category. Use it before writing to check whether a point already exists, or when the user asks what is in the knowledge base.",
      parameters: {
        category: { type: "string", description: "Only list this category (optional)" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        const all = await listEntries(root);
        const wanted = String(args.category ?? "").trim().toLowerCase();
        const entries = wanted ? all.filter((entry) => (entry.category || "").toLowerCase() === wanted) : all;
        if (entries.length === 0) {
          return `知识库为空${wanted ? `（分类 ${args.category}）` : ""}。根目录: ${root}`;
        }
        const lines = entries.map(formatEntryLine);
        return [`知识库 ${root} · ${entries.length} 条`, ...lines].join("\n");
      },
    }),
  );

  register(
    defineTool({
      name: "kb_read",
      description:
        "Read one knowledge-base entry in full: pass the relative path returned by kb_list / kb_search, or the entry title.",
      parameters: {
        file: { type: "string", description: "Relative path such as 数据库/b-tree.md" },
        title: { type: "string", description: "Entry title, used when file is omitted" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        let rel = String(args.file ?? "").trim();
        if (!rel) {
          const wanted = String(args.title ?? "").trim().toLowerCase();
          if (!wanted) throw new Error("file or title is required");
          const found = (await listEntries(root)).find((entry) => entry.title.toLowerCase() === wanted);
          if (!found) throw new Error(`no entry titled ${args.title}`);
          rel = found.file;
        }
        const entry = await readEntry(root, rel);
        return entry.text;
      },
    }),
  );

  register(
    defineTool({
      name: "kb_delete",
      description:
        "Remove one entry from the knowledge base. The file is moved to <root>/.trash/ rather than deleted, so a wrong removal can still be recovered by hand. Use it when the user says a note is wrong, obsolete, or duplicated.",
      parameters: {
        file: { type: "string", description: "Relative path such as 数据库/b-tree.md" },
        title: { type: "string", description: "Entry title, used when file is omitted" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        let rel = String(args.file ?? "").trim();
        if (!rel) {
          const wanted = String(args.title ?? "").trim().toLowerCase();
          if (!wanted) throw new Error("file or title is required");
          const found = (await listEntries(root)).find((entry) => entry.title.toLowerCase() === wanted);
          if (!found) throw new Error(`no entry titled ${args.title}`);
          rel = found.file;
        }
        const result = await deleteEntry(root, rel);
        return [`— 已删除: ${result.file}`, `— 移入回收站: ${result.trashedTo}（可手动恢复）`, `知识库现有条目: ${result.total}`].join("\n");
      },
    }),
  );

  register(
    defineTool({
      name: "kb_search",
      description:
        "Search the user's knowledge base by keyword across titles, tags, summaries and bodies. Use it to recall what was already discussed, or to check for an existing entry to update instead of duplicating.",
      parameters: {
        query: { type: "string", required: true, description: "Keyword or phrase" },
        limit: { type: "number", description: "Max hits, default 10" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        const entries = await listEntries(root);
        const contents = new Map();
        for (const entry of entries) {
          try {
            const raw = await readFile(await resolveInsideReal(root, entry.file), "utf8");
            // Search the prose only: front-matter keys ("title:", "tags:") would
            // otherwise match every entry and bury the real hits.
            contents.set(entry.file, parseFrontMatter(raw).body);
          } catch {
            contents.set(entry.file, "");
          }
        }
        const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 10;
        const hits = searchEntries(entries, contents, String(args.query ?? ""), limit);
        if (hits.length === 0) return `没有命中「${args.query}」。知识库共 ${entries.length} 条，根目录: ${root}`;
        return [`命中 ${hits.length} 条（知识库共 ${entries.length} 条）:`, ...hits.map((hit) => `${formatEntryLine(hit)}\n  ${hit.snippet}`)].join("\n");
      },
    }),
  );

  register(
    defineTool({
      name: "kb_lint",
      description:
        "Health-check the knowledge base: encoding damage (U+FFFD), missing front matter, duplicate titles that would be merged by kb_write, copy-pasted created timestamps, tags too broad to filter, and titles that hard-code a package name. Run it after a batch of kb_write calls, or when the user asks whether the knowledge base is in good shape.",
      parameters: {
        category: { type: "string", description: "Only check this category (optional)" },
      },
      output: textOutput(),
      async execute(args) {
        const root = await rootFor();
        const wanted = String(args.category ?? "").trim().toLowerCase();
        const all = await listEntries(root);
        const entries = wanted ? all.filter((entry) => (entry.category || "").toLowerCase() === wanted) : all;
        const bodies = new Map();
        for (const entry of entries) {
          try {
            bodies.set(entry.file, parseFrontMatter(await readFile(await resolveInsideReal(root, entry.file), "utf8")).body);
          } catch {
            bodies.set(entry.file, "");
          }
        }
        return renderLint(root, entries, lintEntries(entries, bodies));
      },
    }),
  );

  /* -------------------------- HTTP API ---------------------------- */

  ctx.inject?.(["webServer"], (serverCtx) => {
    const webServer = serverCtx.webServer;
    if (!webServer?.register) {
      log("warn", "webServer service unavailable; the sidebar panel will show no data");
      return;
    }

    // Fail closed: every /kb/api request must carry an authenticated live Peer
    // (the same fence the shipped plugins use). Without the connection service
    // we cannot verify anything, so the route answers 403 instead of serving.
    const fence = (req) => {
      const connection = serverCtx.get?.("connection") ?? ctx.get?.("connection");
      if (!connection?.requestRejection) {
        log("warn", "connection service unavailable; /kb/api rejects every request");
        return false;
      }
      try {
        return connection.requestRejection(req) === undefined;
      } catch {
        return false;
      }
    };

    const sendJson = (res, status, payload) => {
      const body = JSON.stringify(payload);
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(body);
    };

    const readBody = async (req) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return {};
      return JSON.parse(text);
    };

    const handler = async (req, res) => {
      try {
        if (!fence(req)) {
          sendJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
          return;
        }
        const url = new URL(req.url ?? "/", "http://dsh.internal");
        const route = url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length + 1) : "";
        const method = req.method ?? "GET";

        if (route === "tree") {
          const root = await rootFor();
          const entries = await ensureRoot(root).then(() => listEntries(root));
          // Prune ghosts in the response only: a GET must not write. The next
          // ui push from the panel persists the cleaned shape.
          const files = new Set(entries.map((entry) => entry.file));
          sendJson(res, 200, { ok: true, root, entries, ui: pruneUi(await readUi(root), files).ui });
          return;
        }

        if (route === "ui") {
          const root = await rootFor();
          if (method === "GET") {
            sendJson(res, 200, { ok: true, ui: await readUi(root) });
            return;
          }
          if (method === "POST") {
            const payload = await readBody(req);
            const current = await readUi(root);
            const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
            const saved = await writeUi(root, {
              pinned: Array.isArray(payload.pinned) ? payload.pinned : current.pinned,
              archived: Array.isArray(payload.archived) ? payload.archived : current.archived,
              groups: isObject(payload.groups) ? { ...current.groups, ...payload.groups } : current.groups,
              order: isObject(payload.order) ? { ...current.order, ...payload.order } : current.order,
            });
            sendJson(res, 200, { ok: true, ui: saved });
            return;
          }
          sendJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: method } });
          return;
        }

        if (route === "read") {
          const rel = url.searchParams.get("file") ?? "";
          if (!rel) {
            sendJson(res, 400, { ok: false, error: { code: "bad-request", message: "file is required" } });
            return;
          }
          const root = await rootFor();
          try {
            const entry = await readEntry(root, rel);
            sendJson(res, 200, { ok: true, file: entry.file, data: entry.data, body: entry.body });
          } catch (error) {
            const message = String(error?.message ?? error);
            if (/escapes the knowledge root/.test(message)) {
              sendJson(res, 403, { ok: false, error: { code: "path-escape", message } });
            } else {
              sendJson(res, 404, { ok: false, error: { code: "not-found", message } });
            }
          }
          return;
        }

        if (route === "settings") {
          if (method === "GET") {
            const settings = await readSettings();
            sendJson(res, 200, { ok: true, root: effectiveRoot(config, settings), fallbackRoot: fallbackRoot(), dshHome: dshHome() });
            return;
          }
          if (method === "POST") {
            const payload = await readBody(req);
            const next = String(payload.root ?? "").trim();
            if (!next) {
              sendJson(res, 400, { ok: false, error: { code: "bad-request", message: "root is required" } });
              return;
            }
            const target = resolve(next);
            await ensureRoot(target);
            await writeSettings({ root: target });
            const entries = await rebuildIndex(target);
            log("info", `knowledge root switched to ${target}`);
            sendJson(res, 200, { ok: true, root: target, entries });
            return;
          }
          sendJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: method } });
          return;
        }

        if (route === "reindex") {
          const root = await rootFor();
          const entries = await rebuildIndex(root);
          sendJson(res, 200, { ok: true, root, entries });
          return;
        }

        sendJson(res, 404, { ok: false, error: { code: "not-found", message: route || "root" } });
      } catch (error) {
        log("warn", `api failure: ${error?.message ?? error}`);
        try {
          if (!res.headersSent) {
            sendJson(res, 500, { ok: false, error: { code: "internal", message: String(error?.message ?? error) } });
          } else {
            res.end();
          }
        } catch {}
      }
    };

    const dispose = webServer.register({ kind: "prefix", path: API_PREFIX, handler });
    ctx.effect?.(() => dispose, `${PLUGIN_ID}: ${API_PREFIX} routes`);
    log("info", `${API_PREFIX} routes registered`);
  });

  log("info", `ready (root: ${config?.root || fallbackRoot()})`);
}
