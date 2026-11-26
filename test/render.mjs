/**
 * Render test for the sidebar panel.
 *
 * There is no bundler and no DOM here: the bundle is loaded behind a fake
 * `window.__ModuleLoader__`, `react` is replaced by a tiny hook shim, and the
 * panel is called as a plain function so its hooks run in order. That is enough
 * to catch the usual client-side breakage (a conditionally called hook, a group
 * rendered as `undefined`, an ordering regression) without a browser.
 *
 * `fetch` is stubbed with a fixture tree so the assertions also cover the
 * pinned / archive / ordering layout.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");
const bundle = await readFile(bundlePath, "utf8");
if (!bundle.includes("__ModuleLoader__")) throw new Error("client bundle is not a module-loader bundle");

/* --- hook shim ----------------------------------------------------------- */

const hooks = { slots: [], index: 0, pending: [], dirty: false };

const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
  }),
  useState(init) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = init;
    return [
      hooks.slots[index],
      (next) => {
        hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
        hooks.dirty = true;
      },
    ];
  },
  useRef(init) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: init };
    return hooks.slots[index];
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect: (fn) => {
    hooks.pending.push(fn);
  },
};

/* --- module loader + fixtures -------------------------------------------- */

const entries = [
  { file: "数据库/B-tree 索引为什么快.md", title: "B-tree 索引为什么快", category: "数据库", summary: "多路平衡树。", tags: ["postgres"], updated: "2026-11-25T02:40:31.204Z" },
  { file: "数据库/覆盖索引.md", title: "覆盖索引", category: "数据库", summary: "避免回表。", tags: ["index"], updated: "2026-11-25T02:41:00.000Z" },
  { file: "GitHub/用 REST API 建仓.md", title: "用 REST API 建仓", category: "GitHub", summary: "九步。", tags: ["github"], updated: "2026-11-25T02:42:00.000Z" },
  { file: "运维/临时排查.md", title: "临时排查", category: "运维", summary: "一次性。", tags: [], updated: "2026-11-25T02:43:00.000Z" },
];

const ui = {
  version: 1,
  pinned: ["GitHub/用 REST API 建仓.md"],
  archived: ["运维/临时排查.md"],
  groups: {},
  order: { "cat:数据库": ["数据库/覆盖索引.md", "数据库/B-tree 索引为什么快.md"] },
};

const calls = [];
globalThis.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: (init && init.method) || "GET", body });
  const payload =
    String(url).includes("kb/api/tree")
      ? { ok: true, root: "F:\\kb", entries, ui }
      : String(url).includes("kb/api/ui")
        ? { ok: true, ui }
        : { ok: true, root: "F:\\kb", entry: entries[0], body: "# 标题\n\n正文" };
  return { ok: true, status: 200, json: async () => payload };
};
globalThis.document = { baseURI: "http://127.0.0.1:53709/" };
globalThis.window = {
  __ModuleLoader__: {
    load: () => {
      throw new Error("the loader stub must be replaced before the import");
    },
  },
};

let exportsRef = null;
globalThis.window.__ModuleLoader__.load = (entry) => {
  exportsRef = entry.factory((name) => {
    if (name === "react") return react;
    if (name === "@deepseek-ai/dsh-client-ui-primitives") return {};
    throw new Error("unexpected module: " + name);
  });
};

await import(pathToFileURL(bundlePath).href);

const slots = [];
const registered = [];
exportsRef.apply({
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      registered.push(options.name);
      slots.push({ options, component });
      return () => {};
    },
  },
});

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
};

const panelSlot = slots.find((slot) => slot.options.name === "sidebar.panellist");
const mainSlot = slots.find((slot) => slot.options.name === "main");
check("sidebar.panellist registered", Boolean(panelSlot));
check("main panel registered with the same key", Boolean(mainSlot) && mainSlot.options.key === panelSlot.options.id);
check("entry label is the Chinese one", panelSlot.options.label === "知识库");

/* --- render -------------------------------------------------------------- */

let tree = null;
for (let pass = 0; pass < 12; pass += 1) {
  hooks.index = 0;
  hooks.pending = [];
  hooks.dirty = false;
  tree = mainSlot.component({});
  for (const effect of hooks.pending) effect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (!hooks.dirty) break;
}

const text = [];
const nodes = [];
const walk = (node) => {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === "string" || typeof node === "number") {
    text.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  if (typeof node.type === "function") {
    nodes.push(node);
    walk(node.type(node.props));
    return;
  }
  node.children.forEach(walk);
};

try {
  walk(tree);
} catch (error) {
  console.error("render threw:", error.constructor.name, error.message);
  failures.push("render did not throw");
}

const flat = text.join(" ");
check("tree was fetched", calls.some((call) => call.url.includes("kb/api/tree")));
check("panel renders the root", flat.includes("F:\\kb"));
check("pinned group is rendered", flat.includes("置顶"));
check("archive group is rendered", flat.includes("收纳夹"));
check("category group is rendered", flat.includes("数据库"));
check("footer names the view-state file", flat.includes(".kb-ui.json"));

const order = ["置顶", "数据库", "收纳夹"].map((needle) => flat.indexOf(needle));
check(
  "groups are ordered pinned / categories / archive",
  order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2],
);
check(
  "a category whose only entry is pinned stops rendering as its own group",
  !flat.includes("GitHub (1)"),
);
check("pinned entry comes before its category entries", flat.indexOf("用 REST API 建仓") < flat.indexOf("B-tree 索引为什么快"));
check("saved order beats the alphabetical fallback", flat.indexOf("覆盖索引") < flat.indexOf("B-tree 索引为什么快"));

/* --- interactions -------------------------------------------------------- */

const byType = (name) => nodes.filter((node) => node.type.name === name);
const rows = byType("EntryRow");
const rowFor = (title) => rows.find((row) => row.props.entry.title === title);
const settle = () => new Promise((resolve) => setTimeout(resolve, 320));

check("entry rows are rendered", rows.length >= 3);

const beforePin = calls.length;
rowFor("覆盖索引").props.onPin();
await settle();
const pinCall = calls.slice(beforePin).find((call) => call.method === "POST" && call.url.includes("kb/api/ui"));
check("pinning sends one debounced POST", Boolean(pinCall));
check("pin payload adds the file", Boolean(pinCall) && pinCall.body.pinned.includes("数据库/覆盖索引.md"));
check(
  "pin payload keeps the archived list",
  Boolean(pinCall) && JSON.stringify(pinCall.body.archived) === JSON.stringify(["运维/临时排查.md"]),
);

const beforeArchive = calls.length;
rowFor("B-tree 索引为什么快").props.onArchive();
await settle();
const archiveCall = calls.slice(beforeArchive).find((call) => call.method === "POST");
check(
  "archiving moves the file into the archive list",
  Boolean(archiveCall) && archiveCall.body.archived.includes("数据库/B-tree 索引为什么快.md"),
);

const beforeGroup = calls.length;
byType("GroupHeader")
  .find((header) => header.props.label === "数据库")
  .props.onToggle();
await settle();
const groupCall = calls.slice(beforeGroup).find((call) => call.method === "POST");
check("collapsing a group stores its flag", Boolean(groupCall) && groupCall.body.groups["cat:数据库"] === true);

// Alt+↑/↓ is the keyboard path to the same order the mouse produces.
const beforeNudge = calls.length;
rowFor("覆盖索引").props.onNudge(rowFor("覆盖索引").props.entry, 1);
await settle();
const nudgeCall = calls.slice(beforeNudge).find((call) => call.method === "POST" && call.url.includes("kb/api/ui"));
check("keyboard nudge sends one POST", Boolean(nudgeCall));
check(
  "keyboard nudge swaps within the group",
  Boolean(nudgeCall) &&
    JSON.stringify(nudgeCall.body.order["cat:数据库"]) === JSON.stringify(["数据库/B-tree 索引为什么快.md", "数据库/覆盖索引.md"]),
);

// The row meta line turns a raw ISO stamp into something a human reads.
check("rows show a relative timestamp", flat.includes("天前") || flat.includes("昨天"));
check("rows show their tags", flat.includes("#postgres"));

if (failures.length > 0) {
  console.error("rendered text:", flat);
  console.error("FAILURES:", failures.join(" | "));
  process.exitCode = 1;
} else {
  console.log("panel renders");
}
