/**
 * dsh-knowledge-vault — client half (web shell).
 *
 * Registers one left-sidebar entry (`sidebar.panellist`) and its matching
 * full-page panel (`main`, same id) so the two are paired by the shell.
 *
 * The panel is READ-ONLY by design: it browses the Markdown knowledge base and
 * can switch the knowledge root, but every content change goes through the
 * `kb_*` tools from a conversation. No markdown module exists on the platform
 * module table, so this file carries a small markdown renderer of its own.
 */
window.__ModuleLoader__.load({
  id: "dsh-knowledge-vault",
  factory: function (require) {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;

    var react = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives") || {};

    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;

    var PANEL_ID = "dsh-knowledge-vault";
    var API_BASE = "kb/api/";
    var LABEL = "\u77e5\u8bc6\u5e93";

    var IconArchive =
      primitives.IconArchiveOutlineRegular ||
      primitives.IconListPenOutlineRegular ||
      primitives.IconFolderCloseRegular;

    /* ------------------------------------------------------------------ */
    /* transport                                                          */
    /* ------------------------------------------------------------------ */

    function api(path, init) {
      var url = new URL(API_BASE + path, document.baseURI).toString();
      var options = Object.assign({ credentials: "same-origin", headers: { accept: "application/json" } }, init || {});
      return fetch(url, options).then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!response.ok || body.ok === false) {
              var message = (body && body.error && body.error.message) || "HTTP " + response.status;
              throw new Error(message);
            }
            return body;
          });
      });
    }

    /* ------------------------------------------------------------------ */
    /* styles (inline; neutral rgba so both themes work)                  */
    /* ------------------------------------------------------------------ */

    var toolButton = {
      appearance: "none",
      border: "1px solid rgba(127,127,127,0.28)",
      background: "rgba(127,127,127,0.08)",
      color: "inherit",
      borderRadius: 6,
      padding: "4px 10px",
      font: "inherit",
      fontSize: 12,
      lineHeight: "18px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    };

    var muted = { color: "rgba(127,127,127,0.95)" };
    var mono = { fontFamily: "var(--dsh-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" };

    /* ------------------------------------------------------------------ */
    /* markdown                                                           */
    /* ------------------------------------------------------------------ */

    var inlineCode = {
      background: "rgba(127,127,127,0.16)",
      borderRadius: 4,
      padding: "1px 5px",
      fontSize: "0.92em",
      fontFamily: "var(--dsh-font-family-mono, ui-monospace, Menlo, monospace)",
    };

    function renderInline(text) {
      var nodes = [];
      var pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
      var last = 0;
      var match;
      var index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        var token = match[0];
        if (token.charAt(0) === "*") {
          nodes.push(h("strong", { key: "b" + index }, token.slice(2, -2)));
        } else if (token.charAt(0) === "`") {
          nodes.push(h("code", { key: "c" + index, style: inlineCode }, token.slice(1, -1)));
        } else {
          var link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
          nodes.push(
            h(
              "a",
              {
                key: "l" + index,
                href: link[2],
                target: "_blank",
                rel: "noreferrer noopener",
                style: { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 },
              },
              link[1],
            ),
          );
        }
        last = match.index + token.length;
        index += 1;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    function headingStyle(level) {
      var sizes = { 1: 22, 2: 18, 3: 16, 4: 14 };
      return {
        fontSize: sizes[level] || 14,
        fontWeight: level <= 2 ? 600 : 500,
        margin: level <= 2 ? "22px 0 10px" : "18px 0 8px",
        lineHeight: 1.4,
      };
    }

    function renderMarkdown(markdown) {
      var lines = String(markdown || "").split(/\r?\n/);
      var blocks = [];
      var paragraph = [];
      var key = 0;

      var flush = function () {
        if (paragraph.length === 0) return;
        blocks.push(h("p", { key: "p" + key++, style: { margin: "0 0 12px", lineHeight: 1.7 } }, renderInline(paragraph.join(" "))));
        paragraph = [];
      };

      var index = 0;
      while (index < lines.length) {
        var line = lines[index];
        var fence = /^\s*```(\w*)\s*$/.exec(line);

        if (fence) {
          flush();
          index += 1;
          var buffer = [];
          while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
            buffer.push(lines[index]);
            index += 1;
          }
          index += 1;
          blocks.push(
            h(
              "pre",
              {
                key: "pre" + key++,
                style: {
                  margin: "0 0 14px",
                  padding: "12px 14px",
                  background: "rgba(127,127,127,0.12)",
                  border: "1px solid rgba(127,127,127,0.18)",
                  borderRadius: 8,
                  overflowX: "auto",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: "var(--dsh-font-family-mono, ui-monospace, Menlo, monospace)",
                },
              },
              h("code", null, buffer.join("\n")),
            ),
          );
          continue;
        }

        var heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          flush();
          blocks.push(h("div", { key: "h" + key++, style: headingStyle(heading[1].length) }, renderInline(heading[2])));
          index += 1;
          continue;
        }

        if (/^\s*$/.test(line)) {
          flush();
          index += 1;
          continue;
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          flush();
          blocks.push(h("hr", { key: "hr" + key++, style: { border: 0, borderTop: "1px solid rgba(127,127,127,0.25)", margin: "18px 0" } }));
          index += 1;
          continue;
        }

        if (/^\s*[-*+]\s+/.test(line)) {
          flush();
          var items = [];
          while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
            items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
            index += 1;
          }
          blocks.push(
            h(
              "ul",
              { key: "ul" + key++, style: { margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.7 } },
              items.map(function (item, itemIndex) {
                return h("li", { key: itemIndex, style: { margin: "2px 0" } }, renderInline(item));
              }),
            ),
          );
          continue;
        }

        if (/^\s*\d+[.)]\s+/.test(line)) {
          flush();
          var ordered = [];
          while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
            ordered.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
            index += 1;
          }
          blocks.push(
            h(
              "ol",
              { key: "ol" + key++, style: { margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.7 } },
              ordered.map(function (item, itemIndex) {
                return h("li", { key: itemIndex, style: { margin: "2px 0" } }, renderInline(item));
              }),
            ),
          );
          continue;
        }

        if (/^>\s?/.test(line)) {
          flush();
          var quote = [];
          while (index < lines.length && /^>\s?/.test(lines[index])) {
            quote.push(lines[index].replace(/^>\s?/, ""));
            index += 1;
          }
          blocks.push(
            h(
              "blockquote",
              {
                key: "q" + key++,
                style: {
                  margin: "0 0 14px",
                  padding: "8px 14px",
                  borderLeft: "3px solid rgba(127,127,127,0.4)",
                  background: "rgba(127,127,127,0.07)",
                  borderRadius: "0 6px 6px 0",
                  lineHeight: 1.7,
                },
              },
              renderInline(quote.join(" ")),
            ),
          );
          continue;
        }

        paragraph.push(line.trim());
        index += 1;
      }
      flush();
      return blocks;
    }

    /* ------------------------------------------------------------------ */
    /* icon                                                               */
    /* ------------------------------------------------------------------ */

    function KnowledgeIcon(props) {
      if (!IconArchive) return null;
      return h(IconArchive, { size: props && props.size });
    }

    /* ------------------------------------------------------------------ */
    /* panel                                                              */
    /* ------------------------------------------------------------------ */

    function EntryRow(props) {
      var entry = props.entry;
      var active = props.active;
      var [hover, setHover] = useState(false);
      var background = active ? "rgba(99,140,255,0.16)" : hover ? "rgba(127,127,127,0.12)" : "transparent";
      return h(
        "div",
        {
          role: "button",
          tabIndex: 0,
          title: entry.file,
          onClick: props.onSelect,
          onMouseEnter: function () {
            setHover(true);
          },
          onMouseLeave: function () {
            setHover(false);
          },
          style: {
            background: background,
            borderRadius: 7,
            padding: "7px 9px",
            cursor: "pointer",
            marginBottom: 2,
          },
        },
        h(
          "div",
          { style: { fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
          entry.title,
        ),
        h(
          "div",
          { style: Object.assign({ fontSize: 11, lineHeight: "16px", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, muted) },
          (entry.summary || entry.file || "") + (entry.tags && entry.tags.length ? "  #" + entry.tags.join(" #") : ""),
        ),
      );
    }

    function KnowledgePanel() {
      var statePair = useState({ loading: true, error: null, root: "", entries: [] });
      var state = statePair[0];
      var setState = statePair[1];

      var selectionPair = useState(null);
      var selected = selectionPair[0];
      var setSelected = selectionPair[1];

      var docPair = useState({ loading: false, error: null, data: null, body: "" });
      var doc = docPair[0];
      var setDoc = docPair[1];

      var queryPair = useState("");
      var query = queryPair[0];
      var setQuery = queryPair[1];

      var editingPair = useState(false);
      var editing = editingPair[0];
      var setEditing = editingPair[1];

      var draftPair = useState("");
      var draft = draftPair[0];
      var setDraft = draftPair[1];

      var statusPair = useState("");
      var status = statusPair[0];
      var setStatus = statusPair[1];

      var load = useCallback(function () {
        setState(function (previous) {
          return Object.assign({}, previous, { loading: true, error: null });
        });
        api("tree")
          .then(function (body) {
            setState({ loading: false, error: null, root: body.root, entries: body.entries || [] });
          })
          .catch(function (error) {
            setState({ loading: false, error: String(error.message || error), root: "", entries: [] });
          });
      }, []);

      useEffect(function () {
        load();
      }, [load]);

      var open = useCallback(function (file) {
        setSelected(file);
        setDoc({ loading: true, error: null, data: null, body: "" });
        api("read?file=" + encodeURIComponent(file))
          .then(function (body) {
            setDoc({ loading: false, error: null, data: body.data || {}, body: body.body || "" });
          })
          .catch(function (error) {
            setDoc({ loading: false, error: String(error.message || error), data: null, body: "" });
          });
      }, []);

      var saveRoot = useCallback(function () {
        var next = String(draft || "").trim();
        if (!next) return;
        setStatus("切换中…");
        api("settings", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ root: next }),
        })
          .then(function (body) {
            setStatus("已切换到 " + body.root);
            setEditing(false);
            setSelected(null);
            setDoc({ loading: false, error: null, data: null, body: "" });
            load();
          })
          .catch(function (error) {
            setStatus("切换失败: " + String(error.message || error));
          });
      }, [draft, load]);

      var filtered = react.useMemo(
        function () {
          var needle = String(query || "").trim().toLowerCase();
          if (!needle) return state.entries;
          return state.entries.filter(function (entry) {
            var haystack = [entry.title, entry.summary, entry.file, (entry.tags || []).join(" ")].join(" ").toLowerCase();
            return haystack.indexOf(needle) !== -1;
          });
        },
        [state.entries, query],
      );

      var groups = react.useMemo(
        function () {
          var map = new Map();
          filtered.forEach(function (entry) {
            var key = entry.category || "未分类";
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
          });
          return Array.from(map.entries());
        },
        [filtered],
      );

      var header = h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px 12px",
            borderBottom: "1px solid rgba(127,127,127,0.2)",
            flexWrap: "wrap",
          },
        },
        h("div", { style: { fontSize: 15, fontWeight: 600, lineHeight: "22px" } }, LABEL),
        h(
          "div",
          {
            style: Object.assign(
              { fontSize: 11.5, lineHeight: "18px", flex: "1 1 220px", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
              mono,
              muted,
            ),
            title: state.root,
          },
          state.root || "—",
        ),
        status ? h("div", { style: Object.assign({ fontSize: 11.5 }, muted) }, status) : null,
        h(
          "button",
          {
            type: "button",
            style: toolButton,
            onClick: function () {
              setDraft(state.root || "");
              setEditing(!editing);
              setStatus("");
            },
          },
          editing ? "取消" : "更换目录",
        ),
        h(
          "button",
          {
            type: "button",
            style: toolButton,
            onClick: function () {
              load();
              if (selected) open(selected);
            },
          },
          "刷新",
        ),
      );

      var editor = editing
        ? h(
            "div",
            { style: { display: "flex", gap: 8, padding: "10px 18px", borderBottom: "1px solid rgba(127,127,127,0.2)", alignItems: "center" } },
            h("input", {
              value: draft,
              spellCheck: false,
              onChange: function (event) {
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === "Enter") saveRoot();
                if (event.key === "Escape") setEditing(false);
              },
              placeholder: "知识库根目录绝对路径，例如 F:\\DeepSeekHarness\\kb",
              style: Object.assign(
                {
                  flex: 1,
                  minWidth: 0,
                  background: "rgba(127,127,127,0.08)",
                  border: "1px solid rgba(127,127,127,0.3)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "inherit",
                  font: "inherit",
                  fontSize: 12.5,
                  outline: "none",
                },
                mono,
              ),
            }),
            h("button", { type: "button", style: toolButton, onClick: saveRoot }, "保存并切换"),
          )
        : null;

      var searchBox = h("input", {
        value: query,
        spellCheck: false,
        onChange: function (event) {
          setQuery(event.target.value);
        },
        placeholder: "搜索标题 / 标签 / 摘要",
        style: {
          width: "100%",
          boxSizing: "border-box",
          background: "rgba(127,127,127,0.08)",
          border: "1px solid rgba(127,127,127,0.24)",
          borderRadius: 7,
          padding: "6px 10px",
          color: "inherit",
          font: "inherit",
          fontSize: 12.5,
          outline: "none",
        },
      });

      var listBody;
      if (state.loading) {
        listBody = h("div", { style: Object.assign({ padding: 14, fontSize: 12.5 }, muted) }, "加载中…");
      } else if (state.error) {
        listBody = h("div", { style: { padding: 14, fontSize: 12.5, color: "var(--dsh-color-danger, #d9534f)" } }, state.error);
      } else if (groups.length === 0) {
        listBody = h(
          "div",
          { style: Object.assign({ padding: 14, fontSize: 12.5, lineHeight: 1.7 }, muted) },
          state.entries.length === 0 ? "知识库还是空的。在对话里说「把这次讨论总结到知识库」，条目会出现在这里。" : "没有匹配的条目。",
        );
      } else {
        listBody = h(
          "div",
          { style: { padding: "8px 10px 18px" } },
          groups.map(function (group) {
            return h(
              "div",
              { key: group[0], style: { marginBottom: 10 } },
              h(
                "div",
                { style: Object.assign({ fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase", padding: "4px 9px 6px" }, muted) },
                group[0] + "  (" + group[1].length + ")",
              ),
              group[1].map(function (entry) {
                return h(EntryRow, {
                  key: entry.file,
                  entry: entry,
                  active: selected === entry.file,
                  onSelect: function () {
                    open(entry.file);
                  },
                });
              }),
            );
          }),
        );
      }

      var listColumn = h(
        "div",
        {
          style: {
            width: 280,
            flex: "0 0 280px",
            minWidth: 0,
            borderRight: "1px solid rgba(127,127,127,0.2)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          },
        },
        h("div", { style: { padding: "10px 10px 8px" } }, searchBox),
        h("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" } }, listBody),
        h(
          "div",
          { style: Object.assign({ padding: "8px 12px", borderTop: "1px solid rgba(127,127,127,0.2)", fontSize: 11 }, muted) },
          "共 " + state.entries.length + " 条 · 只读，修改请在对话里进行",
        ),
      );

      var contentBody;
      if (!selected) {
        contentBody = h(
          "div",
          { style: Object.assign({ padding: "40px 28px", fontSize: 13, lineHeight: 1.9 }, muted) },
          h("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 10, color: "inherit" } }, "左侧选一条知识，或回到对话里新增"),
          h("div", null, "新增/更新方式：在对话里说「把这次讨论总结到知识库」，模型会调用 kb_write，"),
          h("div", null, "把讨论里的技术点按条写入当前目录（同一标题会自动追加「更新」小节）。"),
          h("div", { style: { marginTop: 12 } }, "索引文件: index.md · 每条知识一个 Markdown 文件 · 可直接用 Obsidian / Git 管理"),
        );
      } else if (doc.loading) {
        contentBody = h("div", { style: Object.assign({ padding: 24, fontSize: 12.5 }, muted) }, "加载中…");
      } else if (doc.error) {
        contentBody = h("div", { style: { padding: 24, fontSize: 12.5, color: "var(--dsh-color-danger, #d9534f)" } }, doc.error);
      } else {
        var data = doc.data || {};
        var title = typeof data.title === "string" ? data.title : selected;
        var tags = Array.isArray(data.tags) ? data.tags : [];
        contentBody = h(
          "div",
          null,
          h(
            "div",
            { style: { padding: "16px 24px 6px", borderBottom: "1px solid rgba(127,127,127,0.12)" } },
            h("div", { style: { fontSize: 17, fontWeight: 600, lineHeight: 1.5 } }, title),
            h(
              "div",
              { style: Object.assign({ fontSize: 11.5, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }, muted) },
              h("span", null, selected),
              typeof data.updated === "string" ? h("span", null, "更新 " + data.updated.slice(0, 10)) : null,
              tags.length ? h("span", null, "#" + tags.join(" #")) : null,
              h(
                "button",
                {
                  type: "button",
                  style: Object.assign({}, toolButton, { marginLeft: "auto" }),
                  onClick: function () {
                    var reference = "[[" + (data.category || "") + "/" + title + "]]";
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(reference).then(
                        function () {
                          setStatus("已复制引用");
                        },
                        function () {
                          setStatus("复制失败");
                        },
                      );
                    } else {
                      setStatus("复制不可用");
                    }
                  },
                },
                "复制引用",
              ),
            ),
          ),
          h("div", { style: { padding: "6px 24px 40px", fontSize: 13.5 } }, renderMarkdown(doc.body)),
        );
      }

      var contentColumn = h(
        "div",
        { style: { flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" } },
        contentBody,
      );

      return h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
            boxSizing: "border-box",
            paddingTop: "var(--dsh-frame-top-clearance, 0px)",
          },
        },
        header,
        editor,
        h("div", { style: { display: "flex", flex: 1, minHeight: 0 } }, listColumn, contentColumn),
      );
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                       */
    /* ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 60, label: LABEL },
          KnowledgeIcon,
        );
      });
      ctx.slots.inject("main", function () {
        return ctx.slots.register({ name: "main", key: PANEL_ID }, KnowledgePanel);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
