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

    var IconPin = primitives.IconPinOutlineRegular || null;
    var IconPinOn = primitives.IconPinFillRegular || IconPin;
    var IconArchiveOff = primitives.IconArchiveOffOutlineRegular || null;
    var IconUnarchive = primitives.IconUnarchiveOutlineRegular || null;
    var IconChevronDown = primitives.IconChevronDownOutlineRegular || null;
    var IconChevronRight = primitives.IconChevronRightOutlineRegular || null;

    var useRef = react.useRef;
    var useMemo = react.useMemo;

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

    /* --------------------------- view state --------------------------- */

    var GROUP_PINNED = "pinned";
    var GROUP_ARCHIVE = "archive";

    function categoryKey(name) {
      return "cat:" + (name || "未分类");
    }

    function listOf(value) {
      return Array.isArray(value) ? value : [];
    }

    /** The archive drawer starts folded; every other group starts open. */
    function defaultCollapsed(groupKey) {
      return groupKey === GROUP_ARCHIVE;
    }

    function isCollapsed(ui, groupKey) {
      var recorded = ui && ui.groups ? ui.groups[groupKey] : undefined;
      return typeof recorded === "boolean" ? recorded : defaultCollapsed(groupKey);
    }

    function iconButton(icon, title, onClick) {
      if (!icon) return null;
      return h(
        "button",
        {
          type: "button",
          title: title,
          "aria-label": title,
          onClick: function (event) {
            event.stopPropagation();
            onClick();
          },
          style: {
            appearance: "none",
            border: "none",
            background: "transparent",
            color: "inherit",
            padding: 2,
            margin: 0,
            cursor: "pointer",
            lineHeight: 0,
            opacity: 0.62,
            borderRadius: 4,
          },
        },
        h(icon, { size: 14 }),
      );
    }

    /**
     * "when did I write this" is the question a knowledge base gets asked most,
     * and a raw ISO stamp answers it badly. Months and years collapse to a date
     * because by then the exact day is not the point any more.
     */
    function relativeTime(value) {
      if (typeof value !== "string" || !value) return "";
      var then = Date.parse(value);
      if (Number.isNaN(then)) return value.slice(0, 10);
      var minutes = Math.floor((Date.now() - then) / 60000);
      if (minutes < 1) return "刚刚";
      if (minutes < 60) return minutes + " 分钟前";
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + " 小时前";
      var days = Math.floor(hours / 24);
      if (days === 1) return "昨天";
      if (days < 30) return days + " 天前";
      return value.slice(0, 10);
    }

    /**
     * Wrap the query's occurrences so the reader can see *why* a row matched.
     * Returns a flat array of strings and React elements — no HTML strings.
     */
    function highlightText(text, needle) {
      var source = String(text ?? "");
      var query = String(needle ?? "").trim();
      if (!query) return source;
      var lower = source.toLowerCase();
      var target = query.toLowerCase();
      var parts = [];
      var from = 0;
      var at = lower.indexOf(target);
      var guard = 0;
      while (at !== -1 && guard < 50) {
        if (at > from) parts.push(source.slice(from, at));
        parts.push(
          h(
            "mark",
            {
              key: "m" + at + "-" + guard,
              style: { background: "rgba(255,196,0,0.32)", color: "inherit", borderRadius: 2, padding: "0 1px" },
            },
            source.slice(at, at + target.length),
          ),
        );
        from = at + target.length;
        at = lower.indexOf(target, from);
        guard += 1;
      }
      if (from < source.length) parts.push(source.slice(from));
      return parts;
    }

    function entryMatches(entry, needle, tag) {
      if (tag) {
        var tags = Array.isArray(entry.tags) ? entry.tags : [];
        if (tags.indexOf(tag) === -1) return false;
      }
      var query = String(needle ?? "").trim().toLowerCase();
      if (!query) return true;
      var haystack = [entry.title, entry.summary, entry.file, (entry.tags || []).join(" ")].join(" ").toLowerCase();
      return haystack.indexOf(query) !== -1;
    }

    function GroupHeader(props) {
      var Chevron = props.collapsed ? IconChevronRight : IconChevronDown;
      var [hover, setHover] = useState(false);
      return h(
        "div",
        {
          role: "button",
          tabIndex: 0,
          onClick: props.onToggle,
          onMouseEnter: function () {
            setHover(true);
          },
          onMouseLeave: function () {
            setHover(false);
          },
          onDragOver: function (event) {
            if (!props.onDragOver) return;
            event.preventDefault();
            props.onDragOver(event);
          },
          onDrop: function (event) {
            if (!props.onDrop) return;
            event.preventDefault();
            props.onDrop(event);
          },
          style: Object.assign(
            {
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 9px 6px",
              borderRadius: 6,
              cursor: "pointer",
              userSelect: "none",
              background: props.highlighted
                ? "rgba(99,140,255,0.14)"
                : hover
                  ? "rgba(127,127,127,0.08)"
                  : "transparent",
            },
            muted,
          ),
        },
        Chevron ? h(Chevron, { size: 12 }) : h("span", { style: { width: 10 } }),
        h("span", { style: { fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase" } }, props.label),
        h("span", { style: { fontSize: 11, opacity: 0.8 } }, "(" + props.count + ")"),
      );
    }

    function EntryRow(props) {
      var entry = props.entry;
      var active = props.active;
      var [hover, setHover] = useState(false);
      var background = active ? "rgba(99,140,255,0.16)" : hover ? "rgba(127,127,127,0.12)" : "transparent";
      var edge = props.dropEdge;
      var outline =
        edge === "top"
          ? "inset 0 2px 0 0 rgba(99,140,255,0.9)"
          : edge === "bottom"
            ? "inset 0 -2px 0 0 rgba(99,140,255,0.9)"
            : "none";
      return h(
        "div",
        {
          role: "button",
          tabIndex: 0,
          title: entry.file,
          draggable: props.draggable !== false,
          onClick: props.onSelect,
          onMouseEnter: function () {
            setHover(true);
          },
          onMouseLeave: function () {
            setHover(false);
          },
          onDragStart: function (event) {
            props.onDragStart(event, entry);
          },
          onDragEnd: function (event) {
            props.onDragEnd(event);
          },
          onDragOver: function (event) {
            props.onDragOver(event, entry);
          },
          onDrop: function (event) {
            props.onDrop(event, entry);
          },
          onKeyDown: function (event) {
            if (!event.altKey) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              props.onNudge(entry, event.key === "ArrowUp" ? -1 : 1);
            }
          },
          style: {
            background: background,
            boxShadow: outline,
            borderRadius: 7,
            padding: "7px 9px",
            cursor: "pointer",
            marginBottom: 2,
            opacity: props.dragging ? 0.4 : 1,
          },
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "flex-start", gap: 6 } },
          h(
            "div",
            { style: { flex: 1, minWidth: 0 } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 13, lineHeight: "18px" } },
              props.pinned && IconPinOn ? h(IconPinOn, { size: 12 }) : null,
              h(
                "span",
                { style: { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                highlightText(entry.title, props.query),
              ),
            ),
            h(
              "div",
              { style: Object.assign({ fontSize: 11, lineHeight: "16px", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, muted) },
              highlightText(entry.summary || entry.file || "", props.query),
            ),
            entry.updated || (entry.tags && entry.tags.length)
              ? h(
                  "div",
                  { style: Object.assign({ fontSize: 10.5, lineHeight: "15px", marginTop: 1, opacity: 0.78 }, muted) },
                  [
                    relativeTime(entry.updated),
                    entry.tags && entry.tags.length ? "#" + entry.tags.join(" #") : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                )
              : null,
          ),
          hover
            ? h(
                "div",
                { style: { display: "flex", gap: 2, flex: "0 0 auto" } },
                iconButton(props.pinned ? IconPinOn : IconPin, props.pinned ? "取消置顶" : "置顶", props.onPin),
                iconButton(
                  props.archived ? IconUnarchive : IconArchiveOff,
                  props.archived ? "移出收纳夹" : "收纳到收纳夹",
                  props.onArchive,
                ),
              )
            : null,
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

      var tagPair = useState("");
      var tagFilter = tagPair[0];
      var setTagFilter = tagPair[1];

      var editingPair = useState(false);
      var editing = editingPair[0];
      var setEditing = editingPair[1];

      var draftPair = useState("");
      var draft = draftPair[0];
      var setDraft = draftPair[1];

      var statusPair = useState("");
      var status = statusPair[0];
      var setStatus = statusPair[1];

      var uiPair = useState({ pinned: [], archived: [], groups: {}, order: {} });
      var ui = uiPair[0];
      var setUi = uiPair[1];

      var dragPair = useState(null);
      var dragFile = dragPair[0];
      var setDragFile = dragPair[1];

      var dropPair = useState(null);
      var dropTarget = dropPair[0];
      var setDropTarget = dropPair[1];

      var dropGroupPair = useState(null);
      var dropGroup = dropGroupPair[0];
      var setDropGroup = dropGroupPair[1];

      var uiTimer = useRef(null);
      var layoutRef = useRef([]);

      /** Optimistic local update plus one debounced POST, so dragging feels instant. */
      var pushUi = useCallback(function (next) {
        setUi(next);
        if (uiTimer.current) clearTimeout(uiTimer.current);
        uiTimer.current = setTimeout(function () {
          uiTimer.current = null;
          api("ui", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(next),
          }).catch(function (error) {
            var message = String(error.message || error);
            setStatus(/not-found|404/.test(message) ? "宿主半还是旧版本，重启 DSH 后才能保存排序" : "排序保存失败: " + message);
          });
        }, 220);
      }, []);

      useEffect(function () {
        return function () {
          if (uiTimer.current) clearTimeout(uiTimer.current);
        };
      }, []);

      var load = useCallback(function () {
        setState(function (previous) {
          return Object.assign({}, previous, { loading: true, error: null });
        });
        api("tree")
          .then(function (body) {
            setState({ loading: false, error: null, root: body.root, entries: body.entries || [] });
            if (body.ui) setUi(body.ui);
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
          return state.entries.filter(function (entry) {
            return entryMatches(entry, query, tagFilter);
          });
        },
        [state.entries, query, tagFilter],
      );

      var toggleGroup = useCallback(
        function (groupKey) {
          var next = Object.assign({}, ui, { groups: Object.assign({}, ui.groups) });
          next.groups[groupKey] = !isCollapsed(ui, groupKey);
          pushUi(next);
        },
        [ui, pushUi],
      );

      var togglePin = useCallback(
        function (file) {
          var pinned = listOf(ui.pinned);
          var next = Object.assign({}, ui);
          if (pinned.indexOf(file) !== -1) {
            next.pinned = pinned.filter(function (item) {
              return item !== file;
            });
          } else {
            next.pinned = pinned.concat([file]);
            next.archived = listOf(ui.archived).filter(function (item) {
              return item !== file;
            });
          }
          pushUi(next);
        },
        [ui, pushUi],
      );

      var toggleArchive = useCallback(
        function (file) {
          var archived = listOf(ui.archived);
          var next = Object.assign({}, ui);
          if (archived.indexOf(file) !== -1) {
            next.archived = archived.filter(function (item) {
              return item !== file;
            });
          } else {
            next.archived = archived.concat([file]);
            next.pinned = listOf(ui.pinned).filter(function (item) {
              return item !== file;
            });
          }
          pushUi(next);
        },
        [ui, pushUi],
      );

      /**
       * Move `source` into `groupKey`, landing before/after `targetFile`
       * (append when the drop target is a group header). Dragging into a
       * category group can only reorder inside the entry's own category —
       * a note's category comes from its front-matter, not from the panel.
       */
      var moveEntry = useCallback(
        function (source, groupKey, targetFile, edge) {
          var layoutNow = layoutRef.current || [];
          var ownKey = null;
          layoutNow.forEach(function (group) {
            group.entries.forEach(function (entry) {
              if (entry.file === source) ownKey = group.key;
            });
          });
          var destination = groupKey;
          if (ownKey && destination.indexOf("cat:") === 0 && ownKey !== destination) destination = ownKey;

          var next = Object.assign({}, ui, {
            pinned: listOf(ui.pinned).filter(function (item) {
              return item !== source;
            }),
            archived: listOf(ui.archived).filter(function (item) {
              return item !== source;
            }),
            order: {},
          });
          if (destination === GROUP_PINNED) next.pinned = next.pinned.concat([source]);
          if (destination === GROUP_ARCHIVE) next.archived = next.archived.concat([source]);

          Object.keys(ui.order || {}).forEach(function (key) {
            next.order[key] = listOf(ui.order[key]).filter(function (item) {
              return item !== source;
            });
          });

          var group = null;
          layoutNow.forEach(function (item) {
            if (item.key === destination) group = item;
          });
          var list =
            next.order[destination] && next.order[destination].length
              ? next.order[destination].slice()
              : group
                ? group.entries
                    .map(function (entry) {
                      return entry.file;
                    })
                    .filter(function (file) {
                      return file !== source;
                    })
                : [];
          var at = targetFile ? list.indexOf(targetFile) : -1;
          if (at === -1) list.push(source);
          else list.splice(edge === "top" ? at : at + 1, 0, source);
          next.order[destination] = list;
          pushUi(next);
        },
        [ui, pushUi],
      );

      var toggleSort = useCallback(
        function () {
          var next = Object.assign({}, ui, { sort: ui.sort === "recent" ? "manual" : "recent" });
          pushUi(next);
        },
        [ui, pushUi],
      );

      /**
       * Keyboard equivalent of dragging: Alt+↑/↓ swaps the row with its
       * neighbour in the same group and pins the resulting order. Drag-only
       * reordering is unusable for anyone without a mouse.
       */
      var nudge = useCallback(
        function (entry, delta) {
          var group = null;
          (layoutRef.current || []).forEach(function (item) {
            item.entries.forEach(function (candidate) {
              if (candidate.file === entry.file) group = item;
            });
          });
          if (!group) return;
          var files = group.entries.map(function (item) {
            return item.file;
          });
          var at = files.indexOf(entry.file);
          var to = at + delta;
          if (at === -1 || to < 0 || to >= files.length) return;
          files.splice(at, 1);
          files.splice(to, 0, entry.file);
          var next = Object.assign({}, ui, { sort: "manual", order: Object.assign({}, ui.order) });
          next.order[group.key] = files;
          pushUi(next);
        },
        [ui, pushUi],
      );

      var layout = useMemo(
        function () {
          var pinnedSet = new Set(listOf(ui.pinned));
          var archivedSet = new Set(listOf(ui.archived));
          var buckets = new Map();
          filtered.forEach(function (entry) {
            var key = pinnedSet.has(entry.file)
              ? GROUP_PINNED
              : archivedSet.has(entry.file)
                ? GROUP_ARCHIVE
                : categoryKey(entry.category || "未分类");
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(entry);
          });
          var byRecent = ui.sort === "recent";
          buckets.forEach(function (list, key) {
            var sequence = byRecent ? [] : listOf(ui.order && ui.order[key]);
            list.sort(function (a, b) {
              // "最近更新" is a reading mode, not an edit: it ignores the manual
              // order without erasing it, so switching back restores the drag order.
              if (byRecent) return String(b.updated || "").localeCompare(String(a.updated || ""));
              var ia = sequence.indexOf(a.file);
              var ib = sequence.indexOf(b.file);
              if (ia === -1 && ib === -1) return String(a.title).localeCompare(String(b.title), "zh");
              if (ia === -1) return 1;
              if (ib === -1) return -1;
              return ia - ib;
            });
          });
          var out = [];
          var push = function (key, label) {
            if (!buckets.has(key)) return;
            out.push({ key: key, label: label, entries: buckets.get(key) });
          };
          push(GROUP_PINNED, "置顶");
          Array.from(buckets.keys())
            .filter(function (key) {
              return key.indexOf("cat:") === 0;
            })
            .sort(function (a, b) {
              return a.localeCompare(b, "zh");
            })
            .forEach(function (key) {
              push(key, key.slice(4));
            });
          push(GROUP_ARCHIVE, "收纳夹");
          return out;
        },
        [filtered, ui],
      );

      layoutRef.current = layout;

      var dragStart = function (event, entry) {
        setDragFile(entry.file);
        try {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.file);
        } catch {}
      };

      var dragEnd = function () {
        setDragFile(null);
        setDropTarget(null);
        setDropGroup(null);
      };

      var dragOverRow = function (event, entry) {
        if (!dragFile || dragFile === entry.file) return;
        event.preventDefault();
        event.stopPropagation();
        var rect = event.currentTarget.getBoundingClientRect();
        var edge = event.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
        if (!dropTarget || dropTarget.file !== entry.file || dropTarget.edge !== edge) {
          setDropTarget({ file: entry.file, edge: edge });
        }
        if (dropGroup) setDropGroup(null);
      };

      var dropRow = function (event, entry) {
        if (!dragFile) return;
        event.preventDefault();
        event.stopPropagation();
        var edge = dropTarget && dropTarget.file === entry.file ? dropTarget.edge : "bottom";
        var source = dragFile;
        var groupKey = null;
        (layoutRef.current || []).forEach(function (group) {
          group.entries.forEach(function (item) {
            if (item.file === entry.file) groupKey = group.key;
          });
        });
        dragEnd();
        if (!groupKey || source === entry.file) return;
        moveEntry(source, groupKey, entry.file, edge);
      };

      var dropOnGroup = function (groupKey) {
        var source = dragFile;
        dragEnd();
        if (!source) return;
        moveEntry(source, groupKey, null, null);
      };

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
        listBody = h(
          "div",
          { style: { padding: 14, fontSize: 12.5 } },
          h("div", { style: { color: "var(--dsh-color-danger, #d9534f)", marginBottom: 8 } }, state.error),
          h("button", { type: "button", style: toolButton, onClick: load }, "重试"),
        );
      } else if (layout.length === 0) {
        listBody = h(
          "div",
          { style: Object.assign({ padding: 14, fontSize: 12.5, lineHeight: 1.7 }, muted) },
          state.entries.length === 0 ? "知识库还是空的。在对话里说「把这次讨论总结到知识库」，条目会出现在这里。" : "没有匹配的条目。",
        );
      } else {
        var searching = Boolean(String(query || "").trim());
        var pinnedFiles = listOf(ui.pinned);
        var archivedFiles = listOf(ui.archived);
        listBody = h(
          "div",
          { style: { padding: "8px 10px 18px" } },
          layout.map(function (group) {
            var collapsed = searching ? false : isCollapsed(ui, group.key);
            return h(
              "div",
              { key: group.key, style: { marginBottom: 10 } },
              h(GroupHeader, {
                label: group.label,
                count: group.entries.length,
                collapsed: collapsed,
                highlighted: dropGroup === group.key,
                onToggle: function () {
                  toggleGroup(group.key);
                },
                onDragOver: function () {
                  if (dragFile) setDropGroup(group.key);
                },
                onDrop: function () {
                  dropOnGroup(group.key);
                },
              }),
              collapsed
                ? null
                : group.entries.map(function (entry) {
                    return h(EntryRow, {
                      key: entry.file,
                      entry: entry,
                      query: query,
                      active: selected === entry.file,
                      pinned: pinnedFiles.indexOf(entry.file) !== -1,
                      archived: archivedFiles.indexOf(entry.file) !== -1,
                      dragging: dragFile === entry.file,
                      dropEdge: dropTarget && dropTarget.file === entry.file ? dropTarget.edge : null,
                      onSelect: function () {
                        open(entry.file);
                      },
                      onPin: function () {
                        togglePin(entry.file);
                      },
                      onArchive: function () {
                        toggleArchive(entry.file);
                      },
                      onNudge: nudge,
                      onDragStart: dragStart,
                      onDragEnd: dragEnd,
                      onDragOver: dragOverRow,
                      onDrop: dropRow,
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
        tagFilter
          ? h(
              "div",
              { style: { padding: "0 10px 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 } },
              h(
                "span",
                {
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(99,140,255,0.16)",
                    color: "inherit",
                  },
                },
                "#" + tagFilter,
                h(
                  "button",
                  {
                    type: "button",
                    title: "清除标签筛选",
                    "aria-label": "清除标签筛选",
                    onClick: function () {
                      setTagFilter("");
                    },
                    style: { appearance: "none", border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, lineHeight: 1 },
                  },
                  "×",
                ),
              ),
            )
          : null,
        h("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" } }, listBody),
        h(
          "div",
          { style: Object.assign({ padding: "8px 12px", borderTop: "1px solid rgba(127,127,127,0.2)", fontSize: 11, display: "flex", alignItems: "center", gap: 8 }, muted) },
          h(
            "span",
            { style: { flex: 1, minWidth: 0 } },
            Boolean(String(query || "").trim()) || tagFilter
              ? `命中 ${filtered.length} / 共 ${state.entries.length} 条`
              : "共 " + state.entries.length + " 条 · 置顶/收纳/排序记在 .kb-ui.json",
          ),
          h(
            "button",
            {
              type: "button",
              title: ui.sort === "recent" ? "切换为手动排序（拖拽生效）" : "切换为按最近更新排序",
              onClick: toggleSort,
              style: toolButton,
            },
            ui.sort === "recent" ? "最近更新" : "手动排序",
          ),
        ),
      );

      var contentBody;
      if (!selected) {
        contentBody = h(
          "div",
          { style: Object.assign({ padding: "40px 28px", fontSize: 13, lineHeight: 1.9 }, muted) },
          h("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 10, color: "inherit" } }, "左侧选一条知识，或回到对话里新增"),
          h("div", null, "新增/更新方式：在对话里说「把这次讨论总结到知识库」，模型会调用 kb_write，"),
          h("div", null, "把讨论里的技术点按条写入当前目录（同一标题会自动追加「更新」小节；说「删掉那条」会用 kb_delete，文件进 .trash 可恢复）。"),
          h("div", { style: { marginTop: 12 } }, "排序：拖拽或用 Alt+↑ / Alt+↓；点标签只看同类；底部可切「手动排序 / 最近更新」。"),
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
              tags.length
                ? h(
                    "span",
                    { style: { display: "inline-flex", gap: 6, flexWrap: "wrap" } },
                    tags.map(function (tag) {
                      return h(
                        "button",
                        {
                          key: tag,
                          type: "button",
                          title: "只看这个标签",
                          onClick: function () {
                            setTagFilter(tagFilter === tag ? "" : tag);
                          },
                          style: {
                            appearance: "none",
                            border: "none",
                            background: tagFilter === tag ? "rgba(99,140,255,0.2)" : "transparent",
                            color: "inherit",
                            font: "inherit",
                            fontSize: 11.5,
                            padding: "1px 5px",
                            borderRadius: 999,
                            cursor: "pointer",
                          },
                        },
                        "#" + tag,
                      );
                    }),
                  )
                : null,
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
