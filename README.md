# dsh-knowledge-vault

[![dshopen](https://dshopen.org/badge/dsh-knowledge-vault.json)](https://dshopen.org/zh/plugins/dsh-knowledge-vault/)

把对话里讨论出来的技术点，手动归档成你自己的 Markdown 知识库；左侧边栏提供只读浏览、搜索和更换目录。

> **English.** Turn what you discuss into a personal Markdown knowledge base. Say "整理到知识库" and the model splits the discussion into technical points, writing one Markdown note per point into a plain folder you own — no database, no lock-in, ready for Git or Obsidian. A read-only browser panel lives in the left sidebar.

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

## 四个工具

| 工具 | 作用 |
| --- | --- |
| `kb_write` | 写入一个技术点。同标题已存在时**追加**到原条目下（`## 更新 <日期>`），tags 合并，不产生重复文件 |
| `kb_list` | 列出条目，可按分类过滤。写之前用它查重 |
| `kb_read` | 按相对路径或标题读全文 |
| `kb_search` | 在标题、标签、摘要、正文里搜关键字 |

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

- 图标在左侧活动栏，点击进入「知识库」面板（只读）
- 搜索框 + 按分类分组的条目列表；右侧渲染 Markdown
- 顶部可以改根目录（写入 `DSH_HOME/kb-plugin/settings.json`），改完点刷新
- 底部提示：修改请在对话里进行 —— 面板只读是有意为之，避免「手改文件」和「模型追加」两套写入口打架

## 开发与调试

```powershell
# 宿主半的冒烟测试：用假 ctx 驱动 4 个工具，不需要重启 DSH
node test/smoke.mjs

# 打包含内容自检（tarball 只该有 lib/ + cordis.patch.yml + dsh-plugin.json + README + LICENSE）
pnpm pack
```

改完 `lib/index.js` / `lib/client.js` 后需要重启 DSH 才生效（客户端 bundle 在启动时组合进启动图）。

**注意：不要用 PowerShell 的 `Set-Content` 改这个仓库里的中文文件** —— PS 会按 GBK 读、以 UTF-8 写回，中文全变乱码。用编辑器的 UTF-8 写入。

## 结构

```
dsh-knowledge-vault/
├── package.json        # dsh.bundle.patch + dsh.client 两处声明
├── cordis.patch.yml    # loader row，name 必须等于包名
├── dsh-plugin.json     # manifestVersion 0.15, apiVersion v1alpha1
├── lib/index.js        # 宿主半：4 个工具 + /kb/api 路由
├── lib/client.js       # 浏览器半：sidebar.panellist + main 槽位
├── assets/icon-180.png # 市场图标（180×180），由 assets/make-icon.py 生成
├── scripts/set-repo.mjs # 建好 GitHub 仓库后回填 repository/homepage/bugs
├── test/smoke.mjs        # 用假 ctx 驱动 4 个工具跑断言
├── test/verify-pack.mjs  # 把 tarball 解开再跑一遍两个半（验证发布产物）
└── PUBLISHING.md         # 发布 runbook（npm / dshopen / awesome 市场）
```

## License

MIT © 2026 时迟
