# 发布 runbook — dsh-knowledge-vault

三个阶段：GitHub 仓库 → npm 发布 → 两个市场收录。第 1 步和第 2 步需要你自己的账号，第 3 步是提 PR / issue。

发布前先读一遍 §0 的自检清单，能省掉后面返工。

---

## 0. 发布前自检

```powershell
cd F:/DeepSeekHarness/workspace/plugins/dsh-knowledge-vault

node test/smoke.mjs          # 13 项断言必须全绿
node --check lib/index.js
node --check lib/client.js

# 打包并用「解开的 tarball」跑一遍宿主半 + 客户端半（最接近用户装到的产物）
pnpm pack --pack-destination ../dist
node test/verify-pack.mjs ../dist/dsh-knowledge-vault-0.1.0.tgz
```

tarball 里**应该只有** 6 项（`files` 白名单）：

```
cordis.patch.yml
dsh-plugin.json
lib/client.js
lib/index.js
LICENSE
README.md
package.json
```

包名、loader row、客户端 bundle id 三处必须一致，否则客户端扫描会判定成「not a client row」，表现为工具能用但侧边栏图标消失：

```powershell
Select-String -Path package.json,cordis.patch.yml,lib/client.js,dsh-plugin.json -Pattern 'dsh-knowledge-vault'
```

---

## 1. GitHub 仓库（公开，源码要有）

```powershell
cd F:/DeepSeekHarness/workspace/plugins/dsh-knowledge-vault
git init
git add -A
git commit -m "feat: dsh-knowledge-vault 0.1.0"
git branch -M main
# 在 GitHub 网页上建空仓库 dsh-knowledge-vault（不要勾 README），然后：
git remote add origin https://github.com/<owner>/dsh-knowledge-vault.git
git push -u origin main
```

建仓后做两件事：

```powershell
# 1) 回填 repository / homepage / bugs，并打印市场要填的值
node scripts/set-repo.mjs https://github.com/<owner>/dsh-knowledge-vault
git commit -am "chore: point repository metadata at github" && git push

# 2) 给仓库加 topic：dsh-plugin、deepseek-harness、knowledge-base、markdown
```

> 第二个市场（awesome-dsh-plugin）要求**仓库创建满 24 小时**才收，所以先建仓，再去做 npm 发布，最后回头提 PR。

---

## 2. npm 发布

```powershell
npm login                       # 浏览器里授权
npm whoami
cd F:/DeepSeekHarness/workspace/plugins/dsh-knowledge-vault
npm publish --access public
npm view dsh-knowledge-vault version    # 应该回 0.1.0
```

- 包名已确认在 npm 上**空闲**（`dsh-knowledge-base` / `dsh-kb` / `dsh-knowledge` 被别人占了，本插件用 `dsh-knowledge-vault`）。
- 后续版本：改 `package.json` 的 `version` → `npm publish` → 两个市场会自动跟 `latest`，不用重新投稿。
- 想撤销 72 小时内的版本：`npm unpublish dsh-knowledge-vault@0.1.0`。

装一遍真实产物验证（不要只信 link:）：

```powershell
dsh plugin --profile desktop add dsh-knowledge-vault   # 或 add file:<path>/dsh-knowledge-vault-0.1.0.tgz
```

---

## 3. dshopen.org（Open Plugin Market）

- 索引：https://dshopen.org/index.json
- 索引仓库：https://github.com/polang233/dsh-plugin-index
- 投稿：https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml

issue 里填：

| 字段 | 值 |
| --- | --- |
| name | `dsh-knowledge-vault` |
| repo | `https://github.com/<owner>/dsh-knowledge-vault` |
| npm | `dsh-knowledge-vault` |
| category | `knowledge` |
| 中文简介 | 把对话里讨论出来的技术点手动归档成你自己的 Markdown 知识库，左侧边栏只读浏览与搜索 |
| 英文简介 | Distill discussed technical points into a plain Markdown knowledge base; read-only browser panel in the left sidebar. |
| license | MIT |

收录后徽章生效（README 顶部已放好）：

```markdown
[![dshopen](https://dshopen.org/badge/dsh-knowledge-vault.json)](https://dshopen.org/zh/plugins/dsh-knowledge-vault/)
```

---

## 4. awesome-dsh-plugin（社区市场镜像）

- 索引：https://aaamechanic.github.io/dsh-plugin-market/index.json
- 仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
- 收录方式：向 `data/plugins/<owner>__dsh-knowledge-vault.yml` **新增一个文件** 提 PR

文件内容（注意：描述必须以句号结尾；含 `: ` 的字符串要加引号）：

```yaml
url: https://github.com/<owner>/dsh-knowledge-vault
name: dsh-knowledge-vault
category: knowledge
description:
  en: "Distill discussed technical points into a plain Markdown knowledge base, with a read-only browser panel in the left sidebar."
  zh: "把对话里讨论出来的技术点手动归档成你自己的 Markdown 知识库，左侧边栏只读浏览与搜索。"
icon: https://raw.githubusercontent.com/<owner>/dsh-knowledge-vault/main/assets/icon-180.png
```

硬性门槛（缺一个就被打回）：

- [ ] 仓库创建已满 24 小时
- [ ] `package.json` 里声明了 `dsh.bundle.patch`（本仓库已有）
- [ ] 描述以句号结尾
- [ ] icon 是 180×180 PNG 的 raw 链接（`assets/icon-180.png`，由 `assets/make-icon.py` 生成）
- [ ] 一次 PR 只加一个插件文件

---

## 5. 发完之后

```powershell
# 用户侧安装路径
dsh plugin --profile desktop add dsh-knowledge-vault
```

写个 release note（GitHub Releases）说明四个工具和「为什么是手动触发」，然后就可以把安装命令贴给同事了。
