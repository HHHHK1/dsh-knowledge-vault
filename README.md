# dsh-knowledge-vault

[![dshopen](https://dshopen.org/badge/dsh-knowledge-vault.json)](https://dshopen.org/zh/plugins/dsh-knowledge-vault/)

把对话里讨论出来的技术点，手动归档成你自己的 Markdown 知识库；左侧边栏提供浏览、搜索、置顶、收纳夹和拖拽排序。

> **English.** Turn what you discuss into a personal Markdown knowledge base. Say "整理到知识库" and the model splits the discussion into technical points, writing one Markdown note per point into a plain folder you own — no database, no lock-in, ready for Git or Obsidian. The sidebar panel adds search, pinning, an archive folder and drag-to-reorder, while the notes themselves stay plain Markdown.

## 为什么是「手动」

知识库的价值在于**你认可哪些内容值得留**。自动归纳会把寒暄、一次性排查过程、过期结论一起写进去，时间一长目录就成了日志。

所以这个插件只在你说「整理到知识库」「把这次讨论总结到知识库」时动手：模型把讨论拆成技术点，一个技术点调一次 `kb_write`。

## 安装

```powershell
# 从 npm（发布后可用）
dsh plugin --profile desktop add dsh-knowledge-vault

# 从源码（link: 是符号链接，改代码即时生效）
dsh plugin --profile desktop add link:F:/path/to/dsh-knowledge-vault
```

装完刷新页面：宿主半的工具会热加载，左侧边栏图标随客户端 bundle 一起进来。

## 五个工具

| 工具 | 作用 |
| --- | --- |
| `kb_write` | 写入一个技术点。同标题已存在时**追加**到原条目下（`## 更新 <日期>`），tags 合并，不产生重复文件 |
| `kb_list` | 列出条目，可按分类过滤。写之前用它查重 |
| `kb_read` | 按相对路径或标题读全文 |
| `kb_search` | 在标题、标签、摘要、正文里搜关键字 |
| `kb_lint` | 体检：编码损坏（U+FFFD）、front-matter 缺字段、标题重名、created 时间戳雷同、标签过宽、标题里写死包名 |

`kb_lint` 检查的都是会让知识库慢慢烂掉的东西，跑一次就知道哪条该修：

```
知识库体检 · 8 条 · 根目录: F:\DeepSeekHarness\kb

2 个问题 · 1 条提醒

## 问题
- 数据库/B-tree.md: 正文含 2 个 U+FFFD 替换字符（编码损坏，需要按行重写）
- 标题重名（会被 kb_write 合并成同一条）: 数据库/索引.md | 运维/索引.md

## 提醒
- 标签「github」覆盖 5/8 条，起不到筛选作用
```

## 用法

在对话里说：

> 把这次讨论整理到知识库

模型会把它拆成若干技术点，逐个 `kb_write`，每个技术点一个文件、带分类和标签。想指定分类就直接说分类名（例如「整理到知识库的『数据库』分类」）。

## 存储格式

默认根目录是 `DSH_HOME/../kb`（Windows 上即 `F:\DeepSeekHarness\kb`）——在 DSH 数据目录旁边，不在工作区里；可在面板顶部改成任意目录。

```
kb/
├── index.md                       # 自动重建的索引，按分类分组
└── 数据库/
    └── B-tree 索引为什么快.md      # 一个技术点 = 一个文件
```

条目是带 JSON 标量 front-matter 的纯 Markdown：

```markdown
---
title: "B-tree 索引为什么快"
category: "数据库"
summary: "多路平衡树把树高压到 3~4 层。"
tags: ["postgres","index"]
created: "2026-11-25T02:40:31.132Z"
updated: "2026-11-25T02:40:31.204Z"
source_session: "session-..."
---

# B-tree 索引为什么快

> 多路平衡树把树高压到 3~4 层。

## 机制
...
```

没有隐藏数据库，直接 `git init` 或用 Obsidian 打开这个目录都能用。

## 左侧边栏面板

- 图标在左侧活动栏，点击进入「知识库」面板
- 搜索框 + 分组列表；右侧渲染 Markdown；被搜索时所有分组自动展开
- **置顶**：条目悬停出现图钉按钮，置顶的条目聚到列表最上方的「置顶」组
- **收纳夹**：同一个按钮组里还有收纳按钮，收起的条目进列表最下方的「收纳夹」组（默认折叠），再也不占视线
- **自定义排序**：按住条目拖动，蓝线标出落点；拖到分组标题上 = 追加到该组末尾。分类由 front-matter 决定，面板不会改动分类，只会改显示顺序
- **分组折叠**：点分组标题就收起/展开，状态会被记住
- 顶部可以改根目录（写入 `DSH_HOME/kb-plugin/settings.json`），改完点刷新
- 面板**不写 Markdown**：置顶、收纳、排序和折叠状态都记在知识库根目录的 `.kb-ui.json` 里（原子写入，坏文件自动回退空状态）。正文只由对话里的工具写，避免两套写入口打架

```jsonc
// .kb-ui.json
{
  "version": 1,
  "pinned": ["数据库/B-tree 索引为什么快.md"],
  "archived": ["运维/临时排查记录.md"],
  "groups": { "archive": false },          // 分组折叠状态，缺省时收纳夹默认折叠
  "order": { "pinned": ["数据库/..."], "cat:数据库": ["..."] }
}
```

这个文件是你的，跟着知识与目录一起 `git commit` 就行；删掉它只会丢排序偏好，不会丢任何笔记。

## 安全：不跟随符号链接

知识库目录会跟着 `git clone` 或别人给你的压缩包一起流动，所以它可能已经被塞进一个指向库外的链接。路径前缀检查挡不住这种链接（`外链/secret.md` 里根本没有 `..`），因此每一次读写都会再做一次**真实路径**校验：

- 解析目标之前先 `realpath` 它就近的已存在上级，结果必须仍在库根之内，否则抛 `path escapes the knowledge root through a symlink`
- 列表、搜索、体检都只用 `lstat`：符号链接（文件和目录）直接跳过，不进入
- A file symlink is skipped just like a directory one — `kb_read` 和 `kb_write` 都会在碰盘之前拒绝
- `/kb/api/read` 遇到越界链接返回 **403 `path-escape`**，`/kb/api/tree` 不列出这些条目
- 新增测试 `test/symlink.mjs`：造一个库内链接指向库外目录，断言列表看不到、读不到、写不进、HTTP 两条门都挡住

Windows 上创建文件符号链接需要开发者模式；测试用目录 junction 兜底，所以没有特权也能跑。

## 开发与调试

```powershell
# 宿主半的冒烟测试：用假 ctx 驱动 5 个工具，不需要重启 DSH
node test/smoke.mjs

# /kb/api/ui 的路由级测试：写入、部分合并、脏数据清洗、坏文件回退、fence
node test/ui-state.mjs

# 面板渲染测试：假的 react hook + 假的 fetch，断言分组顺序、置顶/收纳/折叠发出的请求
node test/render.mjs

# kb_lint 的规则测试：一个故意写坏的库必须全部命中，一个干净的库必须静默
node test/lint.mjs

# 符号链接越界测试：库内链接指向库外，列表/读取/写入/HTTP 都必须拒绝
node test/symlink.mjs

# 打包内容自检（tarball 只该有 lib/ + cordis.patch.yml + dsh-plugin.json + README + LICENSE）
pnpm pack
node test/verify-pack.mjs <那个 .tgz>
```

改完 `lib/client.js` 后**刷新页面**即可生效；改 `lib/index.js` 由宿主热加载。

**注意：不要用 PowerShell 的 `Set-Content` 改这个仓库里的中文文件** —— PS 会按 GBK 读、以 UTF-8 写回，中文全变乱码。用编辑器的 UTF-8 写入。

## 结构

```
dsh-knowledge-vault/
├── package.json        # dsh.bundle.patch + dsh.client 两处声明
├── cordis.patch.yml    # loader row，name 必须等于包名
├── dsh-plugin.json     # manifestVersion 0.15, apiVersion v1alpha1
├── lib/index.js        # 宿主半：5 个工具 + /kb/api 路由
├── lib/client.js       # 浏览器半：sidebar.panellist + main 槽位
├── assets/icon-180.png # 市场图标（180×180），由 assets/make-icon.py 生成
├── scripts/set-repo.mjs # 建好 GitHub 仓库后回填 repository/homepage/bugs
├── test/smoke.mjs        # 用假 ctx 驱动 5 个工具跑断言
├── test/ui-state.mjs     # /kb/api/ui 的路由级测试（合并、清洗、fence）
├── test/render.mjs       # 面板渲染测试（假 react hook + 假 fetch）
├── test/lint.mjs         # kb_lint 的规则测试（坏的必须命中，干净的必须静默）
├── test/symlink.mjs      # 符号链接越界测试（列表/读取/写入/HTTP 全拒）
├── test/verify-pack.mjs  # 把 tarball 解开再跑一遍两个半（验证发布产物）
└── PUBLISHING.md         # 发布 runbook（npm / dshopen / awesome 市场）
```

## License

MIT © 2026 时迟
