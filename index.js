"use strict";

const { Plugin, Dialog, showMessage, openTab } = require("siyuan");

const STATE_FILE = "siwords-state.json";
const LEGACY_STATE_FILE = "wordflow-state.json";
const PENDING_FILE = "siwords-pending.json";
const BACKUPS_FILE = "siwords-backups.json";
const SECRETS_FILE = "siwords-secrets.json";
const DOCK_TYPE = "siwords-vocabulary-dock";
const MANAGER_TAB_TYPE = "siwords-library-tab";
const SCHEMA_VERSION = 5;
const PLUGIN_VERSION = "0.6.0";
const MAX_BACKUPS = 10;
const PAGE_SIZE = 20;
const DOCK_PAGE_SIZE = 12;
const DOCUMENT_CACHE_TTL = 15_000;
const AI_CACHE_TTL = 30 * 60 * 1000;
const COLORS = {
  "1": "#e57373", "2": "#f6a94a", "3": "#d8b836",
  "4": "#55ad6d", "5": "#4f9dcc", "6": "#9274c8",
};
const DEFAULT_AI_PROMPT = "请根据上下文解释“{{word}}”。\n上下文：{{sentence}}\n依次给出：词性、中文释义、简明英文释义、原句中的具体含义、一个自然例句。不要使用表格。";
const DEFAULT_TRANSLATE_PROMPT = "Translate the following text to {{to}}. Only return the translation, no explanation.\n\nText: {{text}}";
const AI_PROVIDER_DEFAULTS = {
  "openai-compatible": { apiUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { apiUrl: "https://api.anthropic.com", model: "claude-3-5-haiku-20241022" },
  gemini: { apiUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
  custom: { apiUrl: "", model: "" },
};
function nowISO() { return new Date().toISOString(); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function normalizeSearchText(value) {
  const source = String(value || "");
  const output = [];
  const startMap = [];
  const endMap = [];
  for (let index = 0; index < source.length;) {
    const point = source.codePointAt(index);
    const char = String.fromCodePoint(point);
    const width = char.length;
    const end = index + width;
    if (/^[\u00ad\u200b\u200c\u200d\ufeff]$/u.test(char)) {
      if (endMap.length) endMap[endMap.length - 1] = end;
      index = end;
      continue;
    }
    if (/\s/u.test(char) || char === "\u00a0") {
      if (output[output.length - 1] === " ") endMap[endMap.length - 1] = end;
      else {
        output.push(" ");
        startMap.push(index);
        endMap.push(end);
      }
      index = end;
      continue;
    }
    const normalized = char === "\u2018" || char === "\u2019" ? "'" : char.toLocaleLowerCase();
    for (const normalizedChar of normalized) {
      output.push(normalizedChar);
      startMap.push(index);
      endMap.push(end);
    }
    index = end;
  }
  return { text: output.join(""), startMap, endMap, source };
}
function canonicalKey(value) {
  return normalizeSearchText(value).text.trim();
}
function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function safeMarkdownHref(value) {
  const raw = String(value || "").trim();
  if (!raw || /^(?:javascript|data|vbscript):/i.test(raw)) return "";
  if (/^(?:https?:|mailto:|siyuan:)/i.test(raw) || raw.startsWith("#") || raw.startsWith("/")) return raw;
  return "";
}
function renderInlineMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      const safe = safeMarkdownHref(String(href).replace(/&amp;/g, "&"));
      return safe ? "<a href=\"" + escapeHTML(safe) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + label + "</a>" : label;
    })
    .replace(/\[\[([^\]]+)\]\]/g, "<button type=\"button\" class=\"siwords-internal-link\" data-link=\"$1\">$1</button>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
function fallbackMarkdown(value) {
  const lines = escapeHTML(value || "暂无释义").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let list = "";
  let code = [];
  let inCode = false;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = ""; } };
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      closeList();
      if (inCode) { html.push(`<pre><code>${code.join("\n")}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^&lt;\/?[a-z][\s\S]*&gt;$/i.test(line.trim())) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const next = unordered ? "ul" : "ol";
      if (list !== next) { closeList(); list = next; html.push(`<${list}>`); }
      html.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
    else if (line.trim()) html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode) html.push(`<pre><code>${code.join("\n")}</code></pre>`);
  return html.join("");
}
function sanitizeRenderedHTML(html) {
  if (typeof document === "undefined" || !document.createElement) return String(html || "");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");
  const allowed = new Set(["A","P","BR","STRONG","EM","CODE","PRE","UL","OL","LI","BLOCKQUOTE","H1","H2","H3","H4","H5","H6","HR","DEL","MARK","SPAN","BUTTON"]);
  Array.from(wrapper.querySelectorAll("*")).forEach(function (element) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith.apply(element, Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach(function (attribute) {
      if (attribute.name.startsWith("on") || !["href","target","rel","class","data-link","type"].includes(attribute.name)) element.removeAttribute(attribute.name);
    });
    if (element.tagName === "A") {
      const href = safeMarkdownHref(element.getAttribute("href"));
      if (!href) element.removeAttribute("href");
      else {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
  return wrapper.innerHTML;
}
let sharedLuteRenderer=null;
let luteRendererUnavailable=false;
function getLuteRenderer(){
  if(sharedLuteRenderer)return sharedLuteRenderer;
  if(luteRendererUnavailable||!globalThis.Lute?.New)return null;
  try{
    sharedLuteRenderer=globalThis.Lute.New();
    if(sharedLuteRenderer?.SetSanitize)sharedLuteRenderer.SetSanitize(true);
    return sharedLuteRenderer;
  }catch(_){luteRendererUnavailable=true;return null;}
}
function renderMarkdown(value) {
  const markdown = String(value || "暂无释义");
  try {
    const lute=getLuteRenderer();
    if (lute?.Md2HTML) return sanitizeRenderedHTML(lute.Md2HTML(markdown));
  } catch (_) {}
  return fallbackMarkdown(markdown);
}
function parseDefinitionSections(value) {
  const raw = String(value || "").replace(/\r\n?/g, "\n");
  const pieces = raw.split(/^\s*---\s*$/m);
  const sections = [];
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const titleMatch = lines[0].trim().match(/^\*\*(.+?)\*\*$/);
    if (titleMatch) sections.push({ title: titleMatch[1].trim(), content: lines.slice(1).join("\n").trim() });
    else sections.push({ title: sections.length ? `内容 ${sections.length + 1}` : "释义", content: trimmed });
  }
  return sections;
}
function parsePatternPhrase(value) {
  const original = String(value || "").trim();
  const marker = /(?:\.{3}|…{1,2})/u;
  if (!marker.test(original)) return { isPattern: false, parts: original ? [original] : [], original };
  const parts = original.split(/\s*(?:\.{3}|…{1,2})\s*/u).map((part) => part.trim()).filter(Boolean);
  return { isPattern: parts.length > 1, parts, original };
}
function isWordChar(value) { return Boolean(value) && /[\p{L}\p{N}_]/u.test(value); }
function normalizeAliases(input) {
  const values = Array.isArray(input) ? input : String(input || "").split(/[,，\n]/);
  const seen = new Set();
  return values.map((item) => String(item).trim()).filter((item) => {
    const key = canonicalKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function defaultSettings() {
  return {
    enableAutoHighlight: true,
    showDefinitionOnHover: true,
    showSelectionButton: true,
    enableMasteredFeature: true,
    showMasteredHighlights: false,
    blurDefinitions: false,
    highlightStyle: "underline",
    pronunciationVariant: "us",
    ttsMode: "browser",
    ttsTemplate: "https://dict.youdao.com/dictvoice?audio={{word}}&type=2",
    currentBookId: "default",
    aiPrompt: DEFAULT_AI_PROMPT,
    aiEnabled: true,
    aiSource: "custom",
    aiProvider: "openai-compatible",
    aiApiUrl: AI_PROVIDER_DEFAULTS["openai-compatible"].apiUrl,
    aiModel: AI_PROVIDER_DEFAULTS["openai-compatible"].model,
    aiTemperature: 0.2,
    aiMaxTokens: 600,
    aiExtraParams: "{}",
    aiRetries: 2,
    aiCacheMinutes: 30,
    scopeMode: "all",
    scopeDocIds: "",
    scopeRules: [],
    highlightCode: false,
    highlightLinks: false,
    hoverDelay: 180,
    enableSectionTabs: true,
    enableSelectionTranslate: false,
    translateTargetLang: "zh-CN",
    translatePrompt: DEFAULT_TRANSLATE_PROMPT,
    selectionTranslate: { enabled: false, targetLang: "zh-CN", prompt: DEFAULT_TRANSLATE_PROMPT },
  };
}
function defaultBook() {
  const time = nowISO();
  return { id: "default", name: "默认生词本", color: "2", order: 0, archived: false, enabled: true, createdAt: time, updatedAt: time };
}
function defaultState() {
  const time = nowISO();
  return {
    version: SCHEMA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    libraryId: uid("library"),
    revision: 0,
    updatedAt: time,
    books: [defaultBook()],
    words: [],
    recycleBin: [],
    settings: defaultSettings(),
    migrationHistory: [],
  };
}
function normalizeBook(input, order = 0) {
  const time = nowISO();
  return {
    id: String(input?.id || uid("book")),
    name: String(input?.name || "未命名生词本").trim() || "未命名生词本",
    color: COLORS[String(input?.color)] ? String(input.color) : "2",
    order: Number.isFinite(Number(input?.order)) ? Number(input.order) : order,
    archived: Boolean(input?.archived),
    enabled: input?.enabled !== false,
    createdAt: input?.createdAt || time,
    updatedAt: input?.updatedAt || input?.createdAt || time,
  };
}
function normalizeWord(input, fallbackBookId = "default") {
  const time = nowISO();
  const word = String(input?.word || input?.term || "").trim();
  const mastered = Boolean(input?.mastered || input?.status === "mastered");
  const rawDefinition = String(input?.rawDefinition ?? input?.definition ?? "");
  return {
    id: String(input?.id || uid("word")),
    key: canonicalKey(input?.key || word),
    word,
    aliases: normalizeAliases(input?.aliases),
    language: String(input?.language || "en"),
    definition: rawDefinition,
    rawDefinition,
    sections: parseDefinitionSections(rawDefinition),
    sentence: String(input?.sentence || input?.example || "").trim(),
    sourceDocId: String(input?.sourceDocId || ""),
    sourceBlockId: String(input?.sourceBlockId || input?.sourceDocId || ""),
    sourceTitle: String(input?.sourceTitle || ""),
    sourcePath: String(input?.sourcePath || ""),
    sourceBox: String(input?.sourceBox || ""),
    sourcePdfPage: Number(input?.sourcePdfPage || 0) || 0,
    bookId: String(input?.bookId || fallbackBookId || "default"),
    color: COLORS[String(input?.color)] ? String(input.color) : "",
    mastered,
    masteredAt: mastered ? (input?.masteredAt || time) : "",
    createdAt: input?.createdAt || time,
    updatedAt: input?.updatedAt || input?.createdAt || time,
  };
}
function normalizeScopeRule(input) {
  if (!isPlainObject(input)) return null;
  const id = String(input.id || input.docId || "").trim();
  const path = String(input.path || "").trim().replace(/\/+$/, "") || "";
  const box = String(input.box || input.boxId || "").trim();
  if (!id && !path) return null;
  return { id, path, box, descendants: Boolean(input.descendants) };
}
function normalizeState(input) {
  const state = defaultState();
  if (!isPlainObject(input)) return state;
  state.libraryId = String(input.libraryId || state.libraryId);
  state.revision = Math.max(0, Number(input.revision) || 0);
  state.updatedAt = input.updatedAt || state.updatedAt;
  const incomingSettings = isPlainObject(input.settings) ? input.settings : {};
  state.settings = { ...state.settings, ...incomingSettings };
  const translate = isPlainObject(incomingSettings.selectionTranslate) ? incomingSettings.selectionTranslate : {};
  state.settings.selectionTranslate = { ...defaultSettings().selectionTranslate, ...translate };
  if (Object.prototype.hasOwnProperty.call(incomingSettings, "enableSelectionTranslate")) state.settings.selectionTranslate.enabled = Boolean(incomingSettings.enableSelectionTranslate);
  if (Object.prototype.hasOwnProperty.call(incomingSettings, "translateTargetLang")) state.settings.selectionTranslate.targetLang = String(incomingSettings.translateTargetLang || "zh-CN");
  if (Object.prototype.hasOwnProperty.call(incomingSettings, "translatePrompt")) state.settings.selectionTranslate.prompt = String(incomingSettings.translatePrompt || DEFAULT_TRANSLATE_PROMPT);
  state.settings.enableSelectionTranslate = Boolean(state.settings.selectionTranslate.enabled);
  state.settings.translateTargetLang = String(state.settings.selectionTranslate.targetLang || "zh-CN");
  state.settings.translatePrompt = String(state.settings.selectionTranslate.prompt || DEFAULT_TRANSLATE_PROMPT);
  state.settings.scopeMode = ["all", "include", "exclude"].includes(state.settings.scopeMode) ? state.settings.scopeMode : "all";
  state.settings.scopeRules = (Array.isArray(incomingSettings.scopeRules) ? incomingSettings.scopeRules : []).map(normalizeScopeRule).filter(Boolean);
  state.settings.aiProvider = normalizeAIProvider(state.settings.aiProvider);
  state.settings.aiExtraParams = String(state.settings.aiExtraParams || "{}");
  state.settings.aiRetries = Math.max(0, Math.min(2, Number(state.settings.aiRetries) || 0));
  state.settings.aiCacheMinutes = Math.max(0, Math.min(1440, Number(state.settings.aiCacheMinutes) || 30));
  state.settings.hoverDelay = Math.max(80, Math.min(2000, Number(state.settings.hoverDelay) || 180));
  const fromVersion = Number(input.schemaVersion || input.version || 1);
  if (fromVersion < 4 && !Object.prototype.hasOwnProperty.call(incomingSettings, "aiSource")) state.settings.aiSource = "siyuan";

  const books = Array.isArray(input.books) && input.books.length ? input.books : [defaultBook()];
  state.books = books.map((book, index) => normalizeBook(book, index));
  if (!state.books.some((book) => book.id === "default")) state.books.unshift(defaultBook());
  const bookIds = new Set(state.books.map((book) => book.id));
  if (!bookIds.has(state.settings.currentBookId)) state.settings.currentBookId = "default";
  const source = Array.isArray(input.words) ? input.words : Array.isArray(input.cards) ? input.cards : [];
  const seen = new Map();
  for (const item of source) {
    const word = normalizeWord(item, state.settings.currentBookId);
    if (!word.word) continue;
    if (!bookIds.has(word.bookId)) word.bookId = "default";
    const previous = seen.get(word.key);
    if (!previous) seen.set(word.key, word);
    else {
      previous.aliases = normalizeAliases([...previous.aliases, ...word.aliases]);
      if (!previous.rawDefinition && word.rawDefinition) {
        previous.definition = word.definition;
        previous.rawDefinition = word.rawDefinition;
        previous.sections = word.sections;
      }
      previous.sentence ||= word.sentence;
      previous.sourceDocId ||= word.sourceDocId;
      previous.sourceBlockId ||= word.sourceBlockId;
      previous.sourceTitle ||= word.sourceTitle;
      previous.sourcePath ||= word.sourcePath;
      previous.sourceBox ||= word.sourceBox;
      previous.mastered = previous.mastered || word.mastered;
    }
  }
  state.words = [...seen.values()];
  state.recycleBin = (Array.isArray(input.recycleBin) ? input.recycleBin : []).map((item) => ({
    deletedAt: item.deletedAt || nowISO(),
    reason: String(item.reason || "deleted"),
    word: normalizeWord(item.word || item, state.settings.currentBookId),
  })).filter((item) => item.word.word);
  state.migrationHistory = Array.isArray(input.migrationHistory) ? input.migrationHistory.slice(-20) : [];
  if (fromVersion < SCHEMA_VERSION && !state.migrationHistory.some((item) => Number(item?.from) === fromVersion && Number(item?.to) === SCHEMA_VERSION)) {
    state.migrationHistory.push({ from: fromVersion, to: SCHEMA_VERSION, at: nowISO() });
  }
  state.version = SCHEMA_VERSION;
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}
function validateRawState(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ["词库原始数据不是对象"] };
  const version = Number(input.schemaVersion || input.version || 1);
  const modern = version >= 3;
  if (modern && !Array.isArray(input.books)) errors.push("原始生词本列表不是数组");
  if (modern && !Array.isArray(input.words)) errors.push("原始词条列表不是数组");
  if (!modern && input.cards != null && !Array.isArray(input.cards)) errors.push("旧版词条列表不是数组");
  if (input.settings != null && !isPlainObject(input.settings)) errors.push("原始设置不是对象");
  const bookIds = new Set();
  for (const book of Array.isArray(input.books) ? input.books : []) {
    if (!isPlainObject(book)) { errors.push("原始生词本包含无效项目"); continue; }
    const id = String(book.id || "");
    if (!id || bookIds.has(id)) errors.push("原始生词本 ID 缺失或重复");
    bookIds.add(id);
  }
  const wordIds = new Set();
  const words = Array.isArray(input.words) ? input.words : Array.isArray(input.cards) ? input.cards : [];
  for (const word of words) {
    if (!isPlainObject(word)) { errors.push("原始词条包含无效项目"); continue; }
    const id = String(word.id || "");
    if (id && wordIds.has(id)) errors.push("原始词条 ID 重复：" + id);
    if (id) wordIds.add(id);
  }
  return { ok: errors.length === 0, errors };
}
function validateState(state) {
  const errors = [];
  if (!isPlainObject(state)) errors.push("词库不是对象");
  if (!Array.isArray(state?.books) || !state.books.length) errors.push("至少需要一个生词本");
  if (!Array.isArray(state?.words)) errors.push("词条列表损坏");
  if (!state?.books?.some((book) => book.id === "default")) errors.push("缺少默认生词本");
  const bookIds = new Set();
  for (const book of state?.books || []) {
    if (!book.id || bookIds.has(book.id)) errors.push("生词本 ID 缺失或冲突");
    bookIds.add(book.id);
  }
  const ids = new Set();
  const keys = new Set();
  for (const word of state?.words || []) {
    if (!word.id || ids.has(word.id)) errors.push("词条 ID 冲突：" + (word.word || "未命名"));
    if (!word.key || keys.has(word.key)) errors.push("重复词条：" + (word.word || "未命名"));
    if (!bookIds.has(word.bookId)) errors.push("词条所属生词本不存在：" + (word.word || "未命名"));
    ids.add(word.id);
    keys.add(word.key);
  }
  return { ok: errors.length === 0, errors };
}
function chooseStatePayload(current, pending, legacy) {
  const currentRevision = Number(current?.revision) || 0;
  const pendingRevision = Number(pending?.revision) || 0;
  if (pending && typeof pending === "object" && pendingRevision > currentRevision) return { payload: pending, recoveredPending: true };
  if (current && typeof current === "object" && Object.keys(current).length) return { payload: current, recoveredPending: false };
  return { payload: legacy, recoveredPending: false };
}
function isDocumentInScope(info, settings) {
  const mode = ["all", "include", "exclude"].includes(settings?.scopeMode) ? settings.scopeMode : "all";
  if (mode === "all") return true;
  let rules = (Array.isArray(settings?.scopeRules) ? settings.scopeRules : []).map(normalizeScopeRule).filter(Boolean);
  if (!rules.length) {
    rules = String(settings?.scopeDocIds || "").split(/[\s,，]+/u).map((id) => normalizeScopeRule({ id })).filter(Boolean);
  }
  if (!rules.length) return mode === "exclude";
  const docId = String(info?.docId || "");
  const path = String(info?.path || "").replace(/\/+$/, "");
  const box = String(info?.box || "");
  const matched = rules.some((rule) => {
    if (rule.box && rule.box !== box) return false;
    const idMatch = Boolean(rule.id && rule.id === docId);
    const pathMatch = Boolean(rule.path && (rule.descendants ? (path === rule.path || path.startsWith(rule.path + "/")) : path === rule.path));
    return idMatch || pathMatch;
  });
  return mode === "include" ? matched : !matched;
}
function bookFor(state, word) { return state.books.find((book) => book.id === word.bookId) || state.books[0]; }
function entryColor(state, word) { return COLORS[word.color] ? word.color : (bookFor(state, word)?.color || "2"); }
function buildMatcher(entries) {
  const root = { next: new Map(), outputs: [], patterns: [] };
  for (const entry of entries || []) {
    const terms = normalizeAliases([entry.word, ...(entry.aliases || [])]);
    for (const display of terms) {
      const parsed = parsePatternPhrase(display);
      if (parsed.isPattern) {
        const parts = parsed.parts.map(canonicalKey).filter(Boolean);
        if (parts.length > 1 && !root.patterns.some((item) => item.entry.id === entry.id && item.term === parsed.original)) root.patterns.push({ entry, term: parsed.original, parts });
        continue;
      }
      const term = canonicalKey(display);
      if (!term) continue;
      let node = root;
      for (const char of term) {
        if (!node.next.has(char)) node.next.set(char, { next: new Map(), outputs: [] });
        node = node.next.get(char);
      }
      if (!node.outputs.some((item) => item.entry.id === entry.id && item.term === term)) node.outputs.push({ entry, term });
    }
  }
  return root;
}
function findTermMatches(text, entriesOrMatcher) {
  const source = String(text || "");
  const normalized = normalizeSearchText(source);
  const search = normalized.text;
  const matcher = entriesOrMatcher?.next instanceof Map ? entriesOrMatcher : buildMatcher(entriesOrMatcher || []);
  const candidates = [];
  const mapSegment = (start, end) => {
    if (start < 0 || end <= start || start >= normalized.startMap.length || end - 1 >= normalized.endMap.length) return null;
    return { start: normalized.startMap[start], end: normalized.endMap[end - 1] };
  };
  const hasBoundary = (term, start, end) => {
    const latin = /[\p{Script=Latin}\p{N}]/u.test(term);
    return !latin || (!isWordChar(search[start - 1]) && !isWordChar(search[end]));
  };
  for (let start = 0; start < search.length; start += 1) {
    let node = matcher;
    let cursor = start;
    while (cursor < search.length && node.next.has(search[cursor])) {
      node = node.next.get(search[cursor]);
      cursor += 1;
      for (const output of node.outputs) {
        if (!hasBoundary(output.term, start, cursor)) continue;
        const segment = mapSegment(start, cursor);
        if (segment) candidates.push({ ...segment, segments: [segment], entry: output.entry, term: output.term, matchedText: source.slice(segment.start, segment.end) });
      }
    }
  }
  for (const pattern of matcher.patterns || []) {
    let searchFrom = 0;
    while (searchFrom < search.length) {
      const firstStart = search.indexOf(pattern.parts[0], searchFrom);
      if (firstStart < 0) break;
      const firstEnd = firstStart + pattern.parts[0].length;
      if (!hasBoundary(pattern.parts[0], firstStart, firstEnd)) { searchFrom = firstStart + 1; continue; }
      const normalizedSegments = [{ start: firstStart, end: firstEnd }];
      let cursor = firstEnd;
      let valid = true;
      for (let index = 1; index < pattern.parts.length; index += 1) {
        const part = pattern.parts[index];
        let nextStart = search.indexOf(part, cursor);
        let accepted = false;
        while (nextStart >= 0) {
          const normalizedGap = search.slice(cursor, nextStart);
          const sourceGapStart = cursor > 0 ? normalized.endMap[cursor - 1] : 0;
          const sourceGapEnd = normalized.startMap[nextStart] ?? source.length;
          const originalGap = source.slice(sourceGapStart, sourceGapEnd);
          if (/[\n.,!?;:，。！？；：]/u.test(normalizedGap) || /[\r\n.,!?;:，。！？；：]/u.test(originalGap)) break;
          const nextEnd = nextStart + part.length;
          if (hasBoundary(part, nextStart, nextEnd)) {
            normalizedSegments.push({ start: nextStart, end: nextEnd });
            cursor = nextEnd;
            accepted = true;
            break;
          }
          nextStart = search.indexOf(part, nextStart + 1);
        }
        if (!accepted) { valid = false; break; }
      }
      if (valid) {
        const segments = normalizedSegments.map((segment) => mapSegment(segment.start, segment.end)).filter(Boolean);
        if (segments.length === pattern.parts.length) {
          const start = segments[0].start;
          const end = segments[segments.length - 1].end;
          candidates.push({ start, end, segments, entry: pattern.entry, term: pattern.term, matchedText: source.slice(start, end), pattern: true });
        }
      }
      searchFrom = firstStart + 1;
    }
  }
  const unique = [];
  const identities = new Set();
  for (const item of candidates) {
    const identity = `${item.entry?.id || ""}:${item.start}:${item.end}`;
    if (!identities.has(identity)) { identities.add(identity); unique.push(item); }
  }
  unique.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const selected = [];
  for (const item of unique) if (!selected.some((used) => item.start < used.end && item.end > used.start)) selected.push(item);
  return selected.sort((a, b) => a.start - b.start);
}
function extractSentence(text, offset) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  const point = Math.max(0, Math.min(raw.length, Number(offset) || 0));
  const marks = [".", "!", "?", "。", "！", "？", "\n"];
  const left = Math.max(...marks.map((mark) => raw.lastIndexOf(mark, point - 1)));
  const rights = marks.map((mark) => raw.indexOf(mark, point)).filter((index) => index >= 0);
  const right = rights.length ? Math.min(...rights) + 1 : raw.length;
  return raw.slice(left + 1, right).replace(/\s+/g, " ").trim();
}
function applyTemplate(template, values) {
  const fallback = template == null ? DEFAULT_AI_PROMPT : template;
  return String(fallback).replace(/\{\{(word|sentence|language|text|to|targetLang)\}\}/g, (_, key) => {
    if (key === "sentence") return String(values?.sentence || "无");
    if (key === "to" || key === "targetLang") return String(values?.to || values?.targetLang || "zh-CN");
    return String(values?.[key] || "");
  });
}
function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
function safeRemoteUrl(rawValue, label = "远程地址") {
  let url;
  try { url = new URL(String(rawValue || "").trim()); }
  catch (_) { throw new Error(`${label}不是有效的 URL`); }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url;
  throw new Error(`${label}只允许 HTTPS；localhost、127.0.0.1 和 ::1 可使用 HTTP`);
}
function redactSecret(value, secret) {
  const message = String(value || "");
  const token = String(secret || "");
  return token ? message.split(token).join("[redacted]") : message;
}
function safeTtsUrl(template, word) {
  const raw = String(template || "").replace(/\{\{word\}\}/g, encodeURIComponent(String(word || "")));
  return safeRemoteUrl(raw, "TTS URL").href;
}
function normalizeAIProvider(value) {
  return ["openai-compatible", "anthropic", "gemini", "custom"].includes(value) ? value : "openai-compatible";
}
function detectAIType(provider, apiUrl = "") {
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "gemini";
  if (provider === "openai-compatible") return "openai";
  const lower = String(apiUrl).toLowerCase();
  if (lower.includes("anthropic") || lower.includes("/messages")) return "anthropic";
  if (lower.includes("generativelanguage") || lower.includes("gemini") || lower.includes(":generatecontent")) return "gemini";
  return "openai";
}
function appendPath(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}${path}`;
}
function deepMergeSafe(base, extra) {
  const output = isPlainObject(base) ? deepClone(base) : {};
  if (!isPlainObject(extra)) return output;
  for (const key of Object.keys(extra)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    const value = extra[key];
    if (isPlainObject(value) && isPlainObject(output[key])) output[key] = deepMergeSafe(output[key], value);
    else if (isPlainObject(value)) output[key] = deepMergeSafe({}, value);
    else output[key] = deepClone(value);
  }
  return output;
}
function mergeExtraParams(base, extraParams) {
  let extra = extraParams;
  if (typeof extraParams === "string") {
    const trimmed = extraParams.trim();
    if (!trimmed) return deepMergeSafe(base, {});
    try { extra = JSON.parse(trimmed); }
    catch (error) { throw new Error(`AI 额外参数 JSON 无效：${error.message || error}`); }
  }
  if (extra == null) return deepMergeSafe(base, {});
  if (!isPlainObject(extra)) throw new Error("AI 额外参数必须是 JSON 对象");
  return deepMergeSafe(base, extra);
}
function shouldRetry(errorOrStatus) {
  if (errorOrStatus?.name === "AbortError") return false;
  const status = Number(typeof errorOrStatus === "number" ? errorOrStatus : errorOrStatus?.status);
  if (status) return status === 408 || status === 429 || status >= 500;
  return errorOrStatus instanceof TypeError || Boolean(errorOrStatus?.networkError);
}
function buildAIRequest(config, prompt) {
  const apiUrl = String(config?.apiUrl || "").trim();
  const apiKey = String(config?.apiKey || "").trim();
  const model = String(config?.model || "").trim();
  const type = detectAIType(normalizeAIProvider(config?.provider), apiUrl);
  if (!apiUrl) throw new Error("请填写 API 地址");
  if (!apiKey) throw new Error("请填写 API Key");
  if (!model) throw new Error("请填写模型 ID");
  safeRemoteUrl(apiUrl, "API 地址");
  const temperature = Number.isFinite(Number(config?.temperature)) ? Number(config.temperature) : 0.2;
  const maxTokens = Math.max(64, Number(config?.maxTokens) || 600);
  const extraParams = config?.extraParams ?? config?.aiExtraParams ?? "{}";
  if (type === "anthropic") {
    const endpoint = /\/v1\/messages(?:[/?#]|$)/i.test(apiUrl) ? apiUrl : (/\/v1\/?$/i.test(apiUrl) ? appendPath(apiUrl, "/messages") : appendPath(apiUrl, "/v1/messages"));
    const body = mergeExtraParams({ model, max_tokens: maxTokens, temperature, messages: [{ role: "user", content: prompt }] }, extraParams);
    return { type, endpoint, headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body };
  }
  if (type === "gemini") {
    let endpoint = apiUrl;
    if (!/:generateContent(?:\?|$)/i.test(endpoint)) endpoint = appendPath(endpoint, `/models/${encodeURIComponent(model)}:generateContent`);
    if (!/[?&]key=/i.test(endpoint)) endpoint += `${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
    const body = mergeExtraParams({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: maxTokens } }, extraParams);
    return { type, endpoint, headers: { "Content-Type": "application/json" }, body };
  }
  const endpoint = /\/chat\/completions(?:[/?#]|$)/i.test(apiUrl) ? apiUrl : appendPath(apiUrl, "/chat/completions");
  const body = mergeExtraParams({ model, messages: [{ role: "user", content: prompt }], temperature, max_tokens: maxTokens, stream: false }, extraParams);
  return { type, endpoint, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body };
}
function parseAIResponse(type, payload) {
  let content = "";
  if (type === "anthropic") content = payload?.content?.map?.((item) => item?.text || "").join("\n") || "";
  else if (type === "gemini") content = payload?.candidates?.[0]?.content?.parts?.map?.((item) => item?.text || "").join("\n") || "";
  else {
    const value = payload?.choices?.[0]?.message?.content;
    content = Array.isArray(value) ? value.map((item) => item?.text || item?.content || "").join("\n") : (value || "");
  }
  if (!String(content).trim()) throw new Error(payload?.error?.message || payload?.message || "模型没有返回内容");
  return String(content).trim();
}
function deleteWordState(state, id, reason = "deleted") {
  const index = state.words.findIndex((word) => word.id === id);
  if (index < 0) return false;
  const [word] = state.words.splice(index, 1);
  state.recycleBin.unshift({ deletedAt: nowISO(), reason, word });
  return true;
}
function restoreWordState(state, id) {
  const index = state.recycleBin.findIndex((item) => item.word.id === id);
  if (index < 0) return false;
  const [item] = state.recycleBin.splice(index, 1);
  if (state.words.find((word) => word.key === item.word.key)) return false;
  if (!state.books.some((book) => book.id === item.word.bookId)) item.word.bookId = "default";
  item.word.updatedAt = nowISO(); state.words.push(item.word); return true;
}
class SiWordsPlugin extends Plugin {
  async onload() {
    this.state = defaultState();
    this.secrets = { apiKey: "" };
    this.matcher = buildMatcher([]);
    this.writeQueue = Promise.resolve();
    this.isSaving = false;
    this.storageQuarantined = false;
    this.managerRoot = null;
    this.managerView = "all";
    this.managerSearch = "";
    this.managerBook = "all";
    this.managerSort = "updated";
    this.managerPage = 0;
    this.editorDraft = null;
    this.editorOriginal = "";
    this.dock = null;
    this.dockTab = "current";
    this.dockSearch = "";
    this.dockPage = 0;
    this.refreshTimer = null;
    this.refreshIdle = null;
    this.markdownWarmIdle = null;
    this.markdownRendererWarmed = false;
    this.viewportMetrics = null;
    this.hoverTimer = null;
    this.hideTimer = null;
    this.selectionTimer = null;
    this.selectionActive = false;
    this.hoverPointer = null;
    this.hoverOrigin = null;
    this.suppressHoverUntil = 0;
    this.activePopoverWordId = "";
    this.activePopoverElement = null;
    this.activePopoverHitRects = [];
    this.dockCurrentSignature = null;
    this.managerNeedsRender = false;
    this.dockNeedsRender = false;
    this.observer = null;
    this.aiController = null;
    this.aiControllers = new Set();
    this.translationController = null;
    this.translationGeneration = 0;
    this.aiCache = new Map();
    this.definitionCache = new Map();
    this.siyuanAIConfigCache = null;
    this.surfaceCache = new WeakMap();
    this.hoverScopeCache = new WeakMap();
    this.onMouseUpBound = this.onMouseUp.bind(this);
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onMouseDownBound = this.onMouseDown.bind(this);
    this.onSelectionChangeBound = this.onSelectionChange.bind(this);
    this.onKeyDownBound = (event) => this.onKeyDown?.(event);
    this.onViewportChangeBound = this.onViewportChange.bind(this);
    this.onMenuBound = this.onOpenMenuContent.bind(this);
    this.onEditorBound = () => { this.invalidateSurfaceCache(); this.scheduleRefresh(); };

    const storedSecrets = await this.safeLoad(SECRETS_FILE);
    this.secrets = { apiKey: String(storedSecrets?.apiKey || "") };
    const current = await this.safeLoad(STATE_FILE);
    const pending = await this.safeLoad(PENDING_FILE);
    const legacy = current ? null : await this.safeLoad(LEGACY_STATE_FILE);
    const selected = chooseStatePayload(current, pending, legacy);
    let loadedPayload = selected.payload;
    if (loadedPayload != null && !validateRawState(loadedPayload).ok) {
      const backupPayload = await this.safeLoad(BACKUPS_FILE);
      const snapshots = Array.isArray(backupPayload?.snapshots) ? backupPayload.snapshots : [];
      const recovered = snapshots.find((snapshot) => {
        const raw = snapshot?.rawState ?? snapshot?.state;
        return validateRawState(raw).ok && validateState(normalizeState(raw)).ok;
      });
      if (recovered) {
        loadedPayload = recovered.rawState ?? recovered.state;
        showMessage("SiWords 检测到词库损坏，已恢复最近有效备份", 5000, "error");
      } else {
        this.storageQuarantined = true;
        loadedPayload = null;
        showMessage("SiWords 检测到词库损坏，已停止覆盖原文件；请从备份恢复", 7000, "error");
      }
    }
    this.state = loadedPayload == null ? defaultState() : normalizeState(loadedPayload);
    const validation = validateState(this.state);
    if (!validation.ok) {
      this.storageQuarantined = true;
      this.state = defaultState();
      showMessage(`SiWords 词库校验失败：${validation.errors[0]}`, 6000, "error");
    }
    const sourceVersion = Number(loadedPayload?.schemaVersion || loadedPayload?.version || SCHEMA_VERSION);
    if (loadedPayload && sourceVersion < SCHEMA_VERSION) await this.createBackup(`版本 ${SCHEMA_VERSION} 升级前备份`, loadedPayload);
    this.rebuildMatcher();
    this.addIcons(`<symbol id="iconSiWords" viewBox="0 0 32 32"><path d="M5 4h9c2 0 3.5.7 4.5 2 1-1.3 2.5-2 4.5-2h4v22h-5c-1.8 0-3 .6-3.8 1.8l-.7 1-.7-1C17 26.6 15.8 26 14 26H5V4zm2 2v18h7c1.4 0 2.6.3 3.5.9V8.5C16.9 6.8 15.8 6 14 6H7zm13 2.5v16.4c.9-.6 2.1-.9 3.5-.9H25V6h-2c-1.8 0-2.9.8-3 2.5z"></path></symbol><symbol id="iconSiWordsAdd" viewBox="0 0 32 32"><path d="M14.5 4h3v10.5H28v3H17.5V28h-3V17.5H4v-3h10.5V4z"></path></symbol>`);

    const plugin = this;
    this.addTab({
      type: MANAGER_TAB_TYPE,
      init() { this.element.classList.add("siwords-page-host", "siwords-ui"); plugin.managerRoot = this.element; plugin.renderManager(true); },
      update() { plugin.renderManager(true); },
      beforeDestroy() { plugin.syncDraftFromForm(plugin.managerRoot); },
      destroy() { if (plugin.managerRoot === this.element) plugin.managerRoot = null; },
    });
    this.addDock({
      config: { position: "RightBottom", size: { width: 320, height: 0 }, icon: "iconSiWords", title: "SiWords 生词" },
      data: {}, type: DOCK_TYPE,
      init: (dock) => { this.dock = dock; dock.element.classList.add("siwords-ui"); this.renderDock(undefined, true); },
      update: () => this.renderDock(undefined, true), destroy: () => { this.dock = null; },
    });
    this.addCommand({ langKey: "openVocabulary", hotkey: "⌥⌘H", callback: () => this.openManager() });
    this.addCommand({ langKey: "addSelectedWord", hotkey: "⌥⌘A", callback: () => this.addCurrentSelection() });
    this.addCommand({ langKey: "refreshHighlights", callback: () => this.refreshHighlights() });
    this.eventBus.on("open-menu-content", this.onMenuBound);
    this.eventBus.on("loaded-protyle-static", this.onEditorBound);
    this.eventBus.on("loaded-protyle-dynamic", this.onEditorBound);
    this.eventBus.on("switch-protyle", this.onEditorBound);
    if (!this.storageQuarantined) await this.saveState("启动校验", { increment: false });
    if (selected.recoveredPending) showMessage("SiWords 已从未完成写入中恢复词库", 4500);
    await this.runSelfTest();
    this.scheduleMarkdownWarmup();
  }

  onLayoutReady() {
    this.scheduleMarkdownWarmup();
    this.addTopBar({ icon: "iconSiWords", title: "SiWords 生词高亮", position: "right", callback: () => this.openManager() });
    document.addEventListener("mouseup", this.onMouseUpBound, true);
    document.addEventListener("pointermove", this.onPointerMoveBound, true);
    document.addEventListener("mousedown", this.onMouseDownBound, true);
    document.addEventListener("selectionchange", this.onSelectionChangeBound, true);
    document.addEventListener("keydown", this.onKeyDownBound, true);
    window.addEventListener("scroll", this.onViewportChangeBound, true);
    window.addEventListener("resize", this.onViewportChangeBound, true);
    this.observer = new MutationObserver((items) => {
      let changed=false;
      for(const item of items){
        const element=item.target?.nodeType===Node.ELEMENT_NODE?item.target:item.target?.parentElement;
        const root=element?.closest?.(".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer");
        if(root){this.invalidateSurfaceCache(root);changed=true;}
      }
      if(changed)this.scheduleRefresh();
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    this.applyHighlightStyle(); this.scheduleRefresh(80);
  }
  onunload() {
    if(typeof document!=="undefined"){
      document.removeEventListener("mouseup", this.onMouseUpBound, true);
      document.removeEventListener("pointermove", this.onPointerMoveBound, true);
      document.removeEventListener("mousedown", this.onMouseDownBound, true);
      document.removeEventListener("selectionchange", this.onSelectionChangeBound, true);
      document.removeEventListener("keydown", this.onKeyDownBound, true);
      window.removeEventListener("scroll", this.onViewportChangeBound, true);
      window.removeEventListener("resize", this.onViewportChangeBound, true);
    }
    this.eventBus.off("open-menu-content", this.onMenuBound);
    this.eventBus.off("loaded-protyle-static", this.onEditorBound);
    this.eventBus.off("loaded-protyle-dynamic", this.onEditorBound);
    this.eventBus.off("switch-protyle", this.onEditorBound);
    for(const key of ["refreshTimer","hoverTimer","hideTimer","selectionTimer"]){if(this[key])window.clearTimeout(this[key]);this[key]=null;}
    if(this.refreshIdle!=null&&typeof window.cancelIdleCallback==="function")window.cancelIdleCallback(this.refreshIdle);
    this.refreshIdle=null;
    if(this.markdownWarmIdle!=null){
      if(typeof window.cancelIdleCallback==="function")window.cancelIdleCallback(this.markdownWarmIdle);
      window.clearTimeout?.(this.markdownWarmIdle);
    }
    this.markdownWarmIdle=null;
    this.observer?.disconnect();this.observer=null;
    this.aiController?.abort();this.aiController=null;
    this.aiControllers?.forEach?.((controller)=>controller.abort());this.aiControllers?.clear?.();
    this.translationController?.abort();this.translationController=null;
    this.clearHighlights();
    if(typeof document!=="undefined")document.querySelectorAll(".siwords-float,.siwords-popover,.siwords-translate-popover").forEach((item)=>this.disposeFloatingElement(item));
    if(typeof document!=="undefined")document.querySelectorAll("#siwords-highlight-style").forEach((item)=>item.remove());
    this.surfaceCache=new WeakMap();
  }
  scheduleMarkdownWarmup(){
    if(this.markdownRendererWarmed||this.markdownWarmIdle!=null)return;
    if(typeof window==="undefined"){
      getLuteRenderer();this.markdownRendererWarmed=true;return;
    }
    const warm=()=>{
      this.markdownWarmIdle=null;
      this.captureViewportMetrics();
      renderMarkdown("# SiWords\n\n**warmup**\n\n- item\n\n[link](https://example.com)");
      if(this.activePopoverElement?.isConnected){
        this.markdownRendererWarmed=true;return;
      }
      this.warmingFloatingSurface=true;
      try{
        this.showPopover({
          id:"__siwords_warmup__",word:"SiWords",key:"siwords",aliases:[],patterns:[],
          definition:"**warmup**",rawDefinition:"**warmup**",sections:[],sentence:"warmup",
          sourceTitle:"",mastered:false,color:"1",bookId:this.state?.settings?.currentBookId||"",
          updatedAt:"warmup",
        },16,16);
      }catch(_){}
      finally{this.hidePopover();this.warmingFloatingSurface=false;}
      this.markdownRendererWarmed=true;
    };
    if(typeof window.requestIdleCallback==="function")this.markdownWarmIdle=window.requestIdleCallback(warm,{timeout:500});
    else this.markdownWarmIdle=window.setTimeout(warm,0);
  }
  async safeLoad(file) { try { return await this.loadData(file); } catch (_) { return null; } }
  async saveSecrets() {
    await this.saveData(SECRETS_FILE, { version: 1, apiKey: String(this.secrets?.apiKey || "") });
  }
  async onDataChanged() {
    if (this.isSaving) return;
    const external = await this.safeLoad(STATE_FILE);
    if (!external || Number(external.revision) <= Number(this.state.revision)) return;
    const rawValidation=validateRawState(external);
    if(!rawValidation.ok)return showMessage(`SiWords 检测到外部损坏数据，已拒绝覆盖：${rawValidation.errors[0]}`,5000,"error");
    const next = normalizeState(external);
    if (!validateState(next).ok) return showMessage("SiWords 检测到外部损坏数据，已拒绝覆盖当前词库", 5000, "error");
    this.state = next; this.rebuildMatcher(); this.renderManager(); this.renderDock(); this.scheduleRefresh(30);
    showMessage("SiWords 已加载外部更新的较新词库");
  }
  async saveState(reason = "保存", options = {}) {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      if (this.storageQuarantined && options.allowQuarantine !== true) throw new Error("原词库处于保护状态，已拒绝覆盖");
      const snapshot = normalizeState(this.state);
      if (options.increment !== false) snapshot.revision = Math.max(Number(this.state.revision) || 0, Number(snapshot.revision) || 0) + 1;
      snapshot.updatedAt = nowISO(); snapshot.version = SCHEMA_VERSION; snapshot.schemaVersion = SCHEMA_VERSION;
      const validation = validateState(snapshot);
      if (!validation.ok) throw new Error(validation.errors.join("；"));
      this.isSaving = true;
      try {
        await this.saveData(PENDING_FILE, snapshot);
        if (typeof options.onPendingSaved === "function") {
          try { options.onPendingSaved(snapshot); } catch (_) {}
        }
        await this.saveData(STATE_FILE, snapshot);
        try { await this.removeData(PENDING_FILE); } catch (_) {}
        this.state.revision=Math.max(Number(this.state.revision)||0,Number(snapshot.revision)||0);
        this.state.updatedAt=snapshot.updatedAt;
        this.state.version=SCHEMA_VERSION;
        this.state.schemaVersion=SCHEMA_VERSION;
      } finally { this.isSaving = false; }
      return reason;
    }).catch((error) => { showMessage(`SiWords 保存失败：${error.message || error}`, 6000, "error"); throw error; });
    return this.writeQueue;
  }
  async createBackup(reason = "手动备份", source = this.state) {
    const payload = await this.safeLoad(BACKUPS_FILE);
    const history = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    const rawState = deepClone(source);
    const snapshot = { id: uid("backup"), savedAt: nowISO(), reason, state: deepClone(normalizeState(rawState)), rawState };
    history.unshift(snapshot);
    await this.saveData(BACKUPS_FILE, { version: 1, snapshots: history.slice(0, MAX_BACKUPS) });
    return snapshot;
  }
  async latestBackup() {
    const payload = await this.safeLoad(BACKUPS_FILE);
    return Array.isArray(payload?.snapshots) ? payload.snapshots[0] : null;
  }
  async restoreLatestBackup() {
    const backup = await this.latestBackup();
    if (!backup?.state) return showMessage("还没有可恢复的备份");
    if (!window.confirm(`恢复 ${new Date(backup.savedAt).toLocaleString()} 的备份？当前词库会先备份。`)) return;
    await this.createBackup("恢复前自动备份");
    this.state = normalizeState(backup.state); this.rebuildMatcher();
    await this.saveState("恢复备份"); this.afterVisualChange(); showMessage("SiWords 备份已恢复");
  }
  rebuildMatcher(){this.matcher=buildMatcher(this.activeWords());this.invalidateSurfaceCache?.();}
  activeWords() {
    const enabledBooks = new Set(this.state.books.filter((book) => book.enabled !== false).map((book) => book.id));
    return this.state.words.filter((word) => enabledBooks.has(word.bookId) && (!this.state.settings.enableMasteredFeature || this.state.settings.showMasteredHighlights || !word.mastered));
  }
  entryColor(word) { return entryColor(this.state, word); }
  async commitChange(message = "已保存", options = {}) {
    this.rebuildMatcher();
    await this.saveState(message, options);
    this.afterVisualChange();
    if (message) showMessage(message);
  }
  afterVisualChange() { this.renderManager(); this.renderDock(); this.applyHighlightStyle(); this.scheduleRefresh(30); }

  openManager(draft = undefined) {
    if (draft !== undefined) this.setEditorDraft(draft);
    const result = openTab({ app: this.app, custom: { icon: "iconSiWords", title: "SiWords 生词库", data: {}, id: `${this.name}${MANAGER_TAB_TYPE}` } });
    Promise.resolve(result).finally(() => window.setTimeout(() => this.renderManager(true), 40));
    return result;
  }
  setEditorDraft(value) {
    if (!value) { this.editorDraft = null; this.editorOriginal = ""; return; }
    this.editorDraft = deepClone(value); this.editorOriginal = JSON.stringify(this.editorDraft); this.managerView = "all";
  }
  newWordDraft(source = {}) {
    const bookId=this.availableBooks()[0]?.id||"default";
    return normalizeWord({ word: source.text || "", definition:source.definition||"", rawDefinition:source.definition||"", sentence: source.sentence || "", bookId, sourceDocId: source.sourceDocId || "", sourceBlockId: source.sourceBlockId || "", sourceTitle: source.sourceTitle || "", sourcePath:source.sourcePath||"", sourceBox:source.sourceBox||"", sourcePdfPage: source.sourcePdfPage || 0 }, bookId);
  }
  openWordEditor(initialWord = "", sentence = "", source = {}) {
    const existing = this.state.words.find((item) => item.key === canonicalKey(initialWord));
    return this.openWordDialog(existing || this.newWordDraft({ ...source, text: initialWord, sentence }));
  }
  availableBooks(currentBookId=""){
    const books=this.state.books.filter((book)=>!book.archived&&(book.enabled!==false||book.id===currentBookId));
    return books.length?books:[this.state.books.find((book)=>book.id==="default")].filter(Boolean);
  }
  openWordDialog(value = null) {
    const draft = deepClone(value || this.newWordDraft());
    const exists = this.state.words.some((item) => item.id === draft.id);
    const dialog = new Dialog({
      title: exists ? "编辑单词" : "添加单词",
      content: `<div class="siwords-quick-add siwords-ui">
        <label class="siwords-quick-add__field"><span>单词或短语</span><input class="b3-text-field" data-field="word" value="${escapeHTML(draft.word)}" placeholder="输入单词或短语"></label>
        <div class="siwords-quick-add__row">
          <label class="siwords-quick-add__field"><span>生词本</span><select class="b3-select" data-field="book">${this.availableBooks(draft.bookId)
.map((book)=>`<option value="${escapeHTML(book.id)}" ${book.id===draft.bookId?"selected":""}>${escapeHTML(book.name)}</option>`).join("")}</select></label>
          <label class="siwords-quick-add__field"><span>颜色</span><select class="b3-select" data-field="color"><option value="">跟随生词本</option>${Object.keys(COLORS).map((id)=>`<option value="${id}" ${id===draft.color?"selected":""}>● ${["","红色","橙色","黄色","绿色","蓝色","紫色"][Number(id)]}</option>`).join("")}</select></label>
        </div>
        <label class="siwords-quick-add__field"><span>别名</span><input class="b3-text-field" data-field="aliases" value="${escapeHTML((draft.aliases||[]).join(", "))}" placeholder="多个别名用逗号分隔"></label>
        <label class="siwords-quick-add__field"><span class="siwords-quick-add__definition-label"><span>释义</span>${this.state.settings.aiEnabled?'<button type="button" class="siwords-sparkle" data-action="quick-ai" title="AI 自动填充">✦ <em>AI 自动填充</em></button>':""}</span><textarea class="b3-text-field" data-field="definition" rows="6" placeholder="输入释义，支持简单 Markdown">${escapeHTML(draft.definition)}</textarea></label>
        <label class="siwords-quick-add__field"><span>原句与上下文</span><textarea class="b3-text-field" data-field="sentence" rows="3" placeholder="划词时会自动带入所在句子">${escapeHTML(draft.sentence)}</textarea></label>
        <label class="siwords-checkbox siwords-quick-add__mastered"><input type="checkbox" data-field="mastered" ${draft.mastered?"checked":""}> 已掌握</label>
        <p class="siwords-quick-add__status" data-role="quick-status">AI 只在点击“自动填充”后发送单词与上下文。</p>
        <div class="siwords-quick-add__actions">
          <div>${exists?'<button class="b3-button b3-button--outline siwords-danger" data-action="quick-delete">删除</button>':""}<button class="b3-button b3-button--outline" data-action="quick-speak">发音</button></div>
          <div><button class="b3-button b3-button--cancel" data-action="quick-cancel">取消</button><button class="b3-button b3-button--text" data-action="quick-save">保存</button></div>
        </div>
      </div>`,
      width: "560px",
    });
    const root = dialog.element.querySelector(".siwords-quick-add");
    const readDraft = () => {
      draft.word = root.querySelector('[data-field="word"]').value.trim();
      draft.aliases = normalizeAliases(root.querySelector('[data-field="aliases"]').value);
      draft.bookId = root.querySelector('[data-field="book"]').value || "default";
      draft.color = root.querySelector('[data-field="color"]').value || "";
      draft.definition = root.querySelector('[data-field="definition"]').value;
      draft.rawDefinition = draft.definition;
      draft.sentence = root.querySelector('[data-field="sentence"]').value;
      draft.mastered = Boolean(root.querySelector('[data-field="mastered"]').checked);
      return draft;
    };
    root.querySelector('[data-action="quick-cancel"]').addEventListener("click",()=>dialog.destroy());
    root.querySelector('[data-action="quick-speak"]').addEventListener("click",()=>this.speak(readDraft().word));
    const quickSaveButton = root.querySelector('[data-action="quick-save"]');
    quickSaveButton.addEventListener("click",async()=>{
      if(quickSaveButton.disabled)return;
      quickSaveButton.disabled=true;
      const status=root.querySelector('[data-role="quick-status"]');
      if(status)status.textContent="正在安全保存…";
      let closed=false;
      try{
        const saved=await this.persistWordDraft(readDraft(),{
          onPendingSaved:()=>{
            closed=true;
            dialog.destroy();
          },
        });
        if(saved&&!closed)dialog.destroy();
        if(!saved&&quickSaveButton.isConnected)quickSaveButton.disabled=false;
      }catch(error){
        if(quickSaveButton.isConnected){
          quickSaveButton.disabled=false;
          if(status)status.textContent=`保存失败：${error.message||error}`;
        }
      }
    });
    root.querySelector('[data-action="quick-delete"]')?.addEventListener("click",async()=>{
      if(!window.confirm(`将“${draft.word}”移到回收站？`))return;
      deleteWordState(this.state,draft.id);await this.commitChange("已移到回收站");dialog.destroy();
    });
    root.querySelector('[data-action="quick-ai"]')?.addEventListener("click",async(event)=>{
      const current=readDraft();const button=event.currentTarget;const status=root.querySelector('[data-role="quick-status"]');
      if(!current.word)return showMessage("请先输入单词或短语");
      button.disabled=true;button.classList.add("is-loading");if(status)status.textContent="正在生成上下文释义…";
      try{current.definition=await this.generateDefinition(current.word,current.sentence,current.language);current.rawDefinition=current.definition;current.sections=parseDefinitionSections(current.definition);root.querySelector('[data-field="definition"]').value=current.definition;if(status)status.textContent="AI 释义已生成，请检查后保存。";}
      catch(error){if(status)status.textContent=`生成失败：${error.message||error}`;showMessage(`AI 释义失败：${error.message||error}`,6000,"error");}
      finally{button.disabled=false;button.classList.remove("is-loading");}
    });
    window.setTimeout(()=>{
      if(!root.isConnected)return;
      const active=document.activeElement;
      if(active&&root.contains(active))return;
      root.querySelector(draft.word?'[data-field="definition"]':'[data-field="word"]')?.focus();
    },50);
    this.activeWordDialog = dialog;
    return dialog;
  }
  async persistWordDraft(input, options = {}) {
    const draft = normalizeWord(input, this.state.settings.currentBookId);
    if (!draft.word) { showMessage("单词不能为空"); return false; }
    draft.key = canonicalKey(draft.word);
    const existingById = this.state.words.findIndex((word)=>word.id===draft.id);
    const duplicate = this.state.words.find((word)=>word.key===draft.key&&word.id!==draft.id);
    if (duplicate) { showMessage("该单词已经存在",4000,"error"); return false; }
    const draftKeys = new Set([draft.key,...draft.aliases.map(canonicalKey)]);
    const aliasConflict = this.state.words.find((word)=>word.id!==draft.id&&[word.word,...word.aliases].map(canonicalKey).some((key)=>draftKeys.has(key)));
    if (aliasConflict&&!window.confirm(`“${draft.word}”与“${aliasConflict.word}”的主词或别名冲突，仍然保存？`))return false;
    draft.updatedAt=nowISO();if(!draft.createdAt)draft.createdAt=draft.updatedAt;draft.masteredAt=draft.mastered?(draft.masteredAt||nowISO()):"";
    if(existingById>=0)this.state.words.splice(existingById,1,draft);else this.state.words.push(draft);
    this.state.settings.currentBookId=draft.bookId;
    await this.commitChange(existingById>=0?"生词已更新":"已加入生词本",{onPendingSaved:options.onPendingSaved});
    return true;
  }
  syncDraftFromForm(root = this.managerRoot) {
    if (!this.editorDraft || !root?.querySelector?.(".siwords-editor")) return;
    const field = (name) => root.querySelector(`[data-editor-field="${name}"]`);
    this.editorDraft.word = field("word")?.value?.trim() || "";
    this.editorDraft.aliases = normalizeAliases(field("aliases")?.value);
    this.editorDraft.bookId = field("book")?.value || "default";
    this.editorDraft.color = field("color")?.value || "";
    this.editorDraft.definition = field("definition")?.value || "";
    this.editorDraft.rawDefinition = this.editorDraft.definition;
    this.editorDraft.sentence = field("sentence")?.value || "";
    this.editorDraft.mastered = Boolean(field("mastered")?.checked);
  }
  isDraftDirty() { return Boolean(this.editorDraft && JSON.stringify(this.editorDraft) !== this.editorOriginal); }
  closeEditor(force = false) {
    this.syncDraftFromForm();
    if (!force && this.isDraftDirty() && !window.confirm("放弃尚未保存的词条修改？")) return;
    this.setEditorDraft(null); this.renderManager();
  }

  isRenderSurfaceVisible(element){
    if(!element?.isConnected)return false;
    let current=element;
    while(current&&current!==document.body){
      if(current.hidden||current.getAttribute?.("aria-hidden")==="true"||current.classList?.contains("fn__none"))return false;
      const style=window.getComputedStyle?.(current);
      if(style&&(style.display==="none"||style.visibility==="hidden"))return false;
      current=current.parentElement;
    }
    return true;
  }

  renderManager(force = false) {
    const root = this.managerRoot;
    if (!root || !document.body.contains(root)) return;
    if (!force && !this.isRenderSurfaceVisible(root)) { this.managerNeedsRender = true; return; }
    this.managerNeedsRender = false;
    const learning = this.state.words.filter((word) => !word.mastered).length;
    const mastered = this.state.words.length - learning;
    root.innerHTML = `<div class="siwords-page siwords-ui"><header class="siwords-page__header"><div><h2>SiWords 生词库</h2><p>唯一数据源 · 修订 ${this.state.revision} · ${this.state.words.length} 个词</p></div><span class="fn__flex-1"></span><button class="b3-button b3-button--outline" data-action="backup">立即备份</button><button class="b3-button b3-button--outline" data-action="export">导出</button><button class="b3-button b3-button--text" data-action="new-word">＋ 新增生词</button></header><div class="siwords-page__layout"><aside class="siwords-page__nav">${this.navButton("all", "全部生词", this.state.words.length)}${this.navButton("learning", "学习中", learning)}${this.navButton("mastered", "已掌握", mastered)}${this.navButton("recent", "最近添加", "")}${this.navButton("books", "生词本", this.state.books.length)}${this.navButton("recycle", "回收站", this.state.recycleBin.length)}${this.navButton("settings", "设置与恢复", "")}${this.navButton("about", "说明", "")}<div class="siwords-page__nav-title">生词本</div><button class="siwords-nav-item ${this.managerBook === "all" ? "is-active-book" : ""}" data-book-filter="all"><span>全部</span></button>${this.state.books.filter((book) => !book.archived).sort((a,b)=>a.order-b.order).map((book) => `<button class="siwords-nav-item ${this.managerBook === book.id ? "is-active-book" : ""}" data-book-filter="${escapeHTML(book.id)}"><i style="background:${COLORS[book.color]}"></i><span>${escapeHTML(book.name)}</span><small>${this.state.words.filter((word)=>word.bookId===book.id).length}</small></button>`).join("")}</aside><main class="siwords-page__main">${this.managerMainHTML()}</main>${this.editorDraft ? this.editorHTML(this.editorDraft) : ""}</div></div>`;
    this.bindManager(root);
  }
  navButton(view, label, count) {
    return `<button class="siwords-nav-item ${this.managerView === view ? "is-active" : ""}" data-view="${view}"><span>${label}</span>${count === "" ? "" : `<small>${count}</small>`}</button>`;
  }
  filteredWords() {
    let words = this.state.words.filter((word) => this.managerView === "learning" ? !word.mastered : this.managerView === "mastered" ? word.mastered : true);
    if (this.managerBook !== "all") words = words.filter((word) => word.bookId === this.managerBook);
    const query = canonicalKey(this.managerSearch);
    if (query) words = words.filter((word) => canonicalKey(`${word.word} ${word.aliases.join(" ")} ${word.definition} ${word.sentence}`).includes(query));
    words = [...words];
    if (this.managerSort === "word") words.sort((a,b)=>a.word.localeCompare(b.word));
    else if (this.managerSort === "created") words.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    else words.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (this.managerView === "recent") words = words.slice(0, 100);
    return words;
  }  managerMainHTML() {
    if (this.managerView === "books") return this.booksHTML();
    if (this.managerView === "recycle") return this.recycleHTML();
    if (this.managerView === "settings") return this.settingsHTML();
    if (this.managerView === "about") return this.aboutHTML();
    const words = this.filteredWords();
    const maxPage = Math.max(0, Math.ceil(words.length / PAGE_SIZE) - 1);
    this.managerPage = Math.min(this.managerPage, maxPage);
    const visible = words.slice(this.managerPage * PAGE_SIZE, (this.managerPage + 1) * PAGE_SIZE);
    return `<div class="siwords-library">
      <div class="siwords-library__filters"><input class="b3-text-field" data-role="manager-search" placeholder="搜索单词、别名、释义或例句" value="${escapeHTML(this.managerSearch)}"><select class="b3-select" data-role="manager-sort"><option value="updated" ${this.managerSort === "updated" ? "selected" : ""}>最近修改</option><option value="created" ${this.managerSort === "created" ? "selected" : ""}>最近添加</option><option value="word" ${this.managerSort === "word" ? "selected" : ""}>字母顺序</option></select></div>
      <div class="siwords-library__result"><span><strong>${words.length}</strong> 个结果</span><span>${this.state.words.filter((word)=>!word.mastered).length} 学习中</span><span>${this.state.words.filter((word)=>word.mastered).length} 已掌握</span></div>
      <div class="siwords-library__grid">${visible.map((word) => this.wordRowHTML(word)).join("")}${visible.length ? "" : '<div class="siwords-empty">没有符合条件的生词</div>'}</div>
      ${words.length > PAGE_SIZE ? `<div class="siwords-pagination"><button data-action="prev-page" ${this.managerPage===0?"disabled":""}>上一页</button><span>${this.managerPage+1} / ${maxPage+1}</span><button data-action="next-page" ${this.managerPage===maxPage?"disabled":""}>下一页</button></div>` : ""}
    </div>`;
  }
  wordRowHTML(word) {
    return `<article class="siwords-library-word ${word.mastered?"is-mastered":""}" data-word-id="${escapeHTML(word.id)}" style="--siwords-color:${COLORS[this.entryColor(word)]}">
      <div class="siwords-library-word__head"><span class="siwords-dot" style="background:${COLORS[this.entryColor(word)]}"></span><strong>${escapeHTML(word.word)}</strong><span class="siwords-status ${word.mastered ? "is-mastered" : ""}">${word.mastered ? "已掌握" : "学习中"}</span></div>
      ${word.aliases.length ? `<div class="siwords-library-word__aliases">${escapeHTML(word.aliases.join(", "))}</div>` : ""}
      <div class="siwords-library-word__definition">${this.definitionHTML(word)}</div>
      ${word.sentence ? `<div class="siwords-library-word__sentence">${escapeHTML(word.sentence)}</div>` : ""}
      <div class="siwords-library-word__foot"><span>${escapeHTML(bookFor(this.state, word)?.name || "")}</span><div><button data-action="speak">发音</button><button data-action="master">${word.mastered ? "重学" : "掌握"}</button><button data-action="edit">编辑</button><button data-action="delete">删除</button></div></div>
    </article>`;
  }
  editorHTML(word) {
    return `<aside class="siwords-editor"><div class="siwords-editor__head"><div><strong>${this.state.words.some((item)=>item.id===word.id) ? "编辑生词" : "新增生词"}</strong><small>${word.sourceTitle ? `来源：${escapeHTML(word.sourceTitle)}` : "通过插件界面编辑"}</small></div><button data-action="close-editor">×</button></div><div class="siwords-editor__body"><label>单词或短语<input class="b3-text-field" data-editor-field="word" value="${escapeHTML(word.word)}"></label><label>别名（逗号分隔）<input class="b3-text-field" data-editor-field="aliases" value="${escapeHTML((word.aliases||[]).join(", "))}"></label><div class="siwords-form__row"><label>生词本<select class="b3-select" data-editor-field="book">${this.availableBooks(word.bookId)
.map((book)=>`<option value="${escapeHTML(book.id)}" ${book.id===word.bookId?"selected":""}>${escapeHTML(book.name)}</option>`).join("")}</select></label><label>颜色<select class="b3-select" data-editor-field="color"><option value="">跟随生词本</option>${Object.keys(COLORS).map((id)=>`<option value="${id}" ${id===word.color?"selected":""}>● 颜色 ${id}</option>`).join("")}</select></label></div><label>Markdown 释义<textarea class="b3-text-field" data-editor-field="definition" rows="10">${escapeHTML(word.definition)}</textarea></label><label>原句与上下文<textarea class="b3-text-field" data-editor-field="sentence" rows="4">${escapeHTML(word.sentence)}</textarea></label><label class="siwords-checkbox"><input type="checkbox" data-editor-field="mastered" ${word.mastered?"checked":""}> 已掌握</label><div class="siwords-editor__status" data-role="editor-status">AI 只在点击后发送单词和上下文。</div></div><div class="siwords-editor__actions"><button class="b3-button b3-button--outline" data-action="editor-speak">发音</button><button class="b3-button b3-button--outline" data-action="editor-ai">AI 释义</button><span class="fn__flex-1"></span><button class="b3-button b3-button--cancel" data-action="close-editor">取消</button><button class="b3-button b3-button--text" data-action="save-editor">保存</button></div></aside>`;
  }
  booksHTML() {
    return `<div class="siwords-section-head"><div><h3>生词本</h3><p>“停用”只停止匹配与显示，不删除词条；“归档”只影响管理入口，两者相互独立。</p></div><span class="fn__flex-1"></span><button class="b3-button b3-button--text" data-action="new-book">新建生词本</button></div><div class="siwords-books">${this.state.books.sort((a,b)=>a.order-b.order).map((book)=>{const count=this.state.words.filter(w=>w.bookId===book.id).length;return `<article class="siwords-book ${book.enabled===false?"is-disabled":""}" data-book-id="${escapeHTML(book.id)}"><span class="siwords-book__dot" style="background:${COLORS[book.color]}"></span><div><strong>${escapeHTML(book.name)}</strong><small>${count} 个词${book.enabled===false?" · 已停用":""}${book.archived?" · 已归档":""}</small></div><span class="fn__flex-1"></span><button data-action="toggle-book">${book.enabled===false?"启用":"停用"}</button><button data-action="edit-book">编辑</button>${book.id!=="default"?'<button data-action="archive-book">'+(book.archived?'取消归档':'归档')+'</button><button data-action="delete-book">删除</button>':""}</article>`;}).join("")}</div>`;
  }
  recycleHTML() {
    return `<div class="siwords-section-head"><div><h3>回收站</h3><p>删除的词条保留在这里，手动永久删除前可以恢复。</p></div></div><div class="siwords-table-wrap"><table class="siwords-table"><thead><tr><th>单词</th><th>原生词本</th><th>删除时间</th><th>操作</th></tr></thead><tbody>${this.state.recycleBin.map((item)=>`<tr data-recycle-id="${escapeHTML(item.word.id)}"><td><strong>${escapeHTML(item.word.word)}</strong></td><td>${escapeHTML(bookFor(this.state,item.word)?.name||"默认生词本")}</td><td>${escapeHTML(new Date(item.deletedAt).toLocaleString())}</td><td><button data-action="restore-word">恢复</button><button data-action="purge-word">永久删除</button></td></tr>`).join("")}</tbody></table>${this.state.recycleBin.length?"":'<div class="siwords-empty">回收站为空</div>'}</div>`;
  }
  toggleHTML(key, title, description, checked) {
    return `<label class="siwords-setting"><span><strong>${title}</strong><small>${description}</small></span><input type="checkbox" class="b3-switch" data-setting="${key}" ${checked?"checked":""}></label>`;
  }
  settingsHTML() {
    const s = this.state.settings;
    const customAI = s.aiSource === "custom";
    const providers = [["openai-compatible","OpenAI 兼容"],["anthropic","Anthropic Claude"],["gemini","Google Gemini"],["custom","自定义（按地址识别）"]];
    const rules=(s.scopeRules||[]).map((rule,index)=>`<div class="siwords-scope-picker__item"><span><strong>${escapeHTML(rule.path||rule.id)}</strong><small>${escapeHTML(rule.box||"")}${rule.descendants?" · 含子文档":" · 仅当前文档"}</small></span><button type="button" data-action="scope-remove" data-index="${index}">移除</button></div>`).join("");
    return `<div class="siwords-settings siwords-settings--hiwords">
      <section class="siwords-settings__section"><h3>AI 服务</h3><p class="siwords-settings__intro">可使用插件独立 API，也可复用思源当前启用的 AI。密钥不进入词库导出或备份；公网地址必须使用 HTTPS。</p>
        ${this.toggleHTML("aiEnabled","启用 AI","为释义生成和划词翻译提供模型能力",s.aiEnabled)}
        <label class="siwords-setting"><span><strong>AI 配置来源</strong><small>独立 API 最接近 HiWords</small></span><select class="b3-select" data-setting="aiSource"><option value="custom" ${customAI?"selected":""}>插件独立 API</option><option value="siyuan" ${!customAI?"selected":""}>使用思源当前 AI</option></select></label>
        ${customAI?`<label class="siwords-setting"><span><strong>服务商</strong><small>选择接口协议</small></span><select class="b3-select" data-setting="aiProvider">${providers.map(([id,label])=>`<option value="${id}" ${s.aiProvider===id?"selected":""}>${label}</option>`).join("")}</select></label>
        <label class="siwords-setting siwords-setting--column"><span><strong>API 地址</strong><small>公网仅限 HTTPS；本机服务可使用 HTTP</small></span><input class="b3-text-field" data-setting="aiApiUrl" value="${escapeHTML(s.aiApiUrl)}"></label>
        <label class="siwords-setting siwords-setting--column"><span><strong>API Key</strong><small>仅保存在本机插件数据中</small></span><input class="b3-text-field" type="password" data-secret="apiKey" value="${escapeHTML(this.secrets?.apiKey||"")}"></label>
        <label class="siwords-setting siwords-setting--column"><span><strong>模型 ID</strong><small>使用供应商的稳定模型标识</small></span><input class="b3-text-field" data-setting="aiModel" value="${escapeHTML(s.aiModel)}"></label>`:`<div class="siwords-ai-source-note">当前复用思源设置中已启用的模型；插件不会复制或导出思源密钥。</div>`}
        <div class="siwords-setting-grid"><label><span>Temperature</span><input class="b3-text-field" type="number" min="0" max="2" step="0.1" data-setting="aiTemperature" value="${escapeHTML(s.aiTemperature)}"></label><label><span>最大输出 tokens</span><input class="b3-text-field" type="number" min="64" max="8192" step="64" data-setting="aiMaxTokens" value="${escapeHTML(s.aiMaxTokens)}"></label><label><span>失败重试次数</span><input class="b3-text-field" type="number" min="0" max="2" data-setting="aiRetries" value="${escapeHTML(s.aiRetries)}"></label><label><span>缓存分钟</span><input class="b3-text-field" type="number" min="0" max="1440" data-setting="aiCacheMinutes" value="${escapeHTML(s.aiCacheMinutes)}"></label></div>
        <label class="siwords-setting siwords-setting--column"><span><strong>额外请求参数（JSON）</strong><small>与协议请求体深度合并；无效 JSON 不会保存</small></span><textarea class="b3-text-field" rows="5" data-setting="aiExtraParams">${escapeHTML(s.aiExtraParams)}</textarea></label>
        <div class="siwords-data-actions siwords-ai-actions"><button class="b3-button b3-button--text" data-action="test-ai">测试 AI 连接</button><button class="b3-button b3-button--outline" data-action="import-siyuan-ai">从思源 AI 导入为独立配置</button></div><p class="siwords-muted" data-role="ai-settings-status">测试只发送一个极小请求。</p>
      </section>
      <section class="siwords-settings__section"><h3>AI 释义</h3><label class="siwords-setting siwords-setting--column"><span><strong>释义提示词</strong><small>必须包含 {{word}}；可用 {{sentence}}、{{language}}</small></span><textarea class="b3-text-field" rows="7" data-setting="aiPrompt">${escapeHTML(s.aiPrompt)}</textarea></label><button class="b3-button b3-button--outline" data-action="restore-ai-prompt">恢复默认</button></section>
      <section class="siwords-settings__section"><h3>划词翻译</h3>${this.toggleHTML("enableSelectionTranslate","启用划词翻译","选中 1–500 个字符后显示翻译；旧请求不会覆盖新选择",s.enableSelectionTranslate)}<label class="siwords-setting siwords-setting--column"><span><strong>目标语言</strong><small>例如 zh-CN、en、ja</small></span><input class="b3-text-field" data-setting="translateTargetLang" value="${escapeHTML(s.translateTargetLang)}"></label><label class="siwords-setting siwords-setting--column"><span><strong>翻译提示词</strong><small>必须包含 {{text}} 和 {{to}}</small></span><textarea class="b3-text-field" rows="6" data-setting="translatePrompt">${escapeHTML(s.translatePrompt)}</textarea></label><button class="b3-button b3-button--outline" data-action="restore-translate-prompt">恢复默认</button></section>
      <section class="siwords-settings__section"><h3>释义显示</h3>${this.toggleHTML("enableSectionTabs","分节标签","定义含独立 --- 分隔线时显示标签；关闭后仍显示完整原文",s.enableSectionTabs)}${this.toggleHTML("blurDefinitions","主动回忆","默认模糊释义，悬停后显示",s.blurDefinitions)}</section>
      <section class="siwords-settings__section"><h3>划词与高亮</h3>${this.toggleHTML("enableAutoHighlight","自动高亮","高亮启用生词本中的学习词",s.enableAutoHighlight)}${this.toggleHTML("showDefinitionOnHover","悬停释义","跨节点短语也能弹出词卡",s.showDefinitionOnHover)}${this.toggleHTML("showSelectionButton","划词添加按钮","选中文本后显示加入生词本入口",s.showSelectionButton)}${this.toggleHTML("enableMasteredFeature","掌握状态","区分学习中和已掌握",s.enableMasteredFeature)}${this.toggleHTML("showMasteredHighlights","高亮已掌握词","开启后已掌握词仍匹配",s.showMasteredHighlights)}${this.toggleHTML("highlightCode","高亮代码块","默认跳过代码",s.highlightCode)}${this.toggleHTML("highlightLinks","高亮链接文字","默认跳过链接",s.highlightLinks)}
        <label class="siwords-setting"><span><strong>高亮样式</strong><small>选择文中标记效果</small></span><select class="b3-select" data-setting="highlightStyle">${[["underline","下划线"],["background","背景色"],["bold","加粗"],["dotted","点线"],["wavy","波浪线"]].map(([id,label])=>`<option value="${id}" ${s.highlightStyle===id?"selected":""}>${label}</option>`).join("")}</select></label>
        <label class="siwords-setting"><span><strong>高亮范围</strong><small>空的“仅指定”表示不高亮任何文档</small></span><select class="b3-select" data-setting="scopeMode"><option value="all" ${s.scopeMode==="all"?"selected":""}>所有文档</option><option value="include" ${s.scopeMode==="include"?"selected":""}>仅指定文档</option><option value="exclude" ${s.scopeMode==="exclude"?"selected":""}>排除指定文档</option></select></label>
        <div class="siwords-scope-picker"><div class="siwords-scope-picker__head"><strong>结构化范围</strong><button type="button" class="b3-button b3-button--outline" data-action="scope-add-current">加入当前文档</button></div>${rules||'<p class="siwords-muted">尚未添加文档范围。</p>'}</div>
        <label class="siwords-setting siwords-setting--column"><span><strong>兼容旧版文档 ID</strong><small>逗号或换行分隔；建议新范围使用上方按钮</small></span><textarea class="b3-text-field" rows="3" data-setting="scopeDocIds">${escapeHTML(s.scopeDocIds)}</textarea></label>
      </section>
      <section class="siwords-settings__section"><h3>发音</h3><label class="siwords-setting"><span><strong>口音</strong><small>系统语音使用</small></span><select class="b3-select" data-setting="pronunciationVariant"><option value="us" ${s.pronunciationVariant==="us"?"selected":""}>美式</option><option value="uk" ${s.pronunciationVariant==="uk"?"selected":""}>英式</option></select></label><label class="siwords-setting"><span><strong>发音方式</strong><small>自定义失败时回退系统语音</small></span><select class="b3-select" data-setting="ttsMode"><option value="browser" ${s.ttsMode==="browser"?"selected":""}>系统语音</option><option value="url" ${s.ttsMode==="url"?"selected":""}>自定义 URL</option></select></label><label class="siwords-setting siwords-setting--column"><span><strong>TTS URL 模板</strong><small>使用 {{word}}；公网仅限 HTTPS</small></span><input class="b3-text-field" data-setting="ttsTemplate" value="${escapeHTML(s.ttsTemplate)}"></label></section>
      <section class="siwords-settings__section"><h3>数据与恢复</h3><div class="siwords-data-actions"><button class="b3-button b3-button--outline" data-action="backup">立即备份</button><button class="b3-button b3-button--outline" data-action="restore-backup">恢复最近备份</button><button class="b3-button b3-button--outline" data-action="export">导出完整 JSON</button><button class="b3-button b3-button--outline" data-action="import">导入 JSON</button></div><p class="siwords-muted">API Key 不进入导出和备份。</p></section>
    </div>`;
  }
  aboutHTML() {
    return `<div class="siwords-about"><h3>SiWords 0.6.0</h3><p>使用插件结构化数据作为唯一可信来源，管理页只是编辑界面，不生成第二份可编辑词库文档。</p><ul><li>多生词本、颜色、别名和掌握状态</li><li>划词、右键和命令面板添加</li><li>思源文档及文字层 PDF 高亮</li><li>悬停释义、当前文档侧栏和 TTS</li><li>插件独立 API 或思源当前模型生成上下文释义</li><li>写入恢复、滚动备份、回收站、导入导出</li><li>大词库分页、空闲时高亮与按版本自检，减少主线程长任务</li><li>公网 AI 与自定义发音地址强制使用 HTTPS</li></ul><p class="siwords-muted">不包含 Canvas、扫描 PDF OCR、移动端完整交互和多设备逐词自动合并。</p></div>`;
  }
  bindManager(root) {
    root.querySelectorAll("[data-view]").forEach((button)=>button.addEventListener("click",()=>{this.syncDraftFromForm(root);this.managerView=button.dataset.view;this.managerPage=0;this.renderManager();}));
    root.querySelectorAll("[data-book-filter]").forEach((button)=>button.addEventListener("click",()=>{this.syncDraftFromForm(root);this.managerBook=button.dataset.bookFilter;this.managerView="all";this.managerPage=0;this.renderManager();}));
    root.querySelector('[data-role="manager-search"]')?.addEventListener("change",(event)=>{this.syncDraftFromForm(root);this.managerSearch=event.target.value;this.managerPage=0;this.renderManager();});
    root.querySelector('[data-role="manager-sort"]')?.addEventListener("change",(event)=>{this.syncDraftFromForm(root);this.managerSort=event.target.value;this.managerPage=0;this.renderManager();});
    root.querySelector('[data-action="new-word"]')?.addEventListener("click",()=>this.openWordDialog(this.newWordDraft()));
    root.querySelectorAll('[data-action="close-editor"]').forEach((button)=>button.addEventListener("click",()=>this.closeEditor()));
    root.querySelector('[data-action="save-editor"]')?.addEventListener("click",()=>this.saveEditor());
    root.querySelector('[data-action="editor-speak"]')?.addEventListener("click",()=>{this.syncDraftFromForm(root);this.speak(this.editorDraft.word);});
    root.querySelector('[data-action="editor-ai"]')?.addEventListener("click",(event)=>this.fillEditorWithAI(event));
    root.querySelector('[data-action="new-book"]')?.addEventListener("click",()=>this.openBookDialog());
    root.querySelectorAll("[data-word-id]").forEach((row)=>this.bindRowActions(row));
    root.querySelectorAll("[data-book-id]").forEach((row)=>this.bindBookActions(row));
    root.querySelectorAll("[data-recycle-id]").forEach((row)=>this.bindRecycleActions(row));
    root.querySelectorAll("[data-setting]").forEach((control)=>control.addEventListener("change",()=>this.saveSetting(control)));
    root.querySelectorAll("[data-secret]").forEach((control)=>control.addEventListener("change",()=>this.saveSecret(control)));
    root.querySelector('[data-action="test-ai"]')?.addEventListener("click",()=>this.testAIConnection());
    root.querySelector('[data-action="import-siyuan-ai"]')?.addEventListener("click",()=>this.importAIFromSiyuan());
    root.querySelector('[data-action="restore-ai-prompt"]')?.addEventListener("click",async()=>{this.state.settings.aiPrompt=DEFAULT_AI_PROMPT;this.aiCache.clear();await this.commitChange("已恢复默认 AI 提示词");});
    root.querySelector('[data-action="restore-translate-prompt"]')?.addEventListener("click",async()=>{this.state.settings.translatePrompt=DEFAULT_TRANSLATE_PROMPT;this.state.settings.selectionTranslate.prompt=DEFAULT_TRANSLATE_PROMPT;this.aiCache.clear();await this.commitChange("已恢复默认翻译提示词");});
    root.querySelector('[data-action="scope-add-current"]')?.addEventListener("click",async()=>{const info=this.surfaceInfo(this.activeSurfaceRoot());if(!info.docId&&!info.path)return showMessage("当前没有可识别的思源文档");const rule=normalizeScopeRule({id:info.docId,path:info.path,box:info.box,descendants:false});if(!rule)return;const duplicate=(this.state.settings.scopeRules||[]).some((item)=>(rule.id&&item.id===rule.id)||(rule.path&&item.path===rule.path&&item.box===rule.box));if(duplicate)return showMessage("当前文档已在范围列表中");this.state.settings.scopeRules.push(rule);await this.commitChange("已加入当前文档范围");});
    root.querySelectorAll('[data-action="scope-remove"]').forEach((button)=>button.addEventListener("click",async()=>{this.state.settings.scopeRules.splice(Number(button.dataset.index),1);await this.commitChange("已移除文档范围");}));
    root.querySelectorAll('[data-action="backup"]').forEach((button)=>button.addEventListener("click",async()=>{await this.createBackup("手动备份");showMessage("SiWords 备份已创建");}));
    root.querySelector('[data-action="restore-backup"]')?.addEventListener("click",()=>this.restoreLatestBackup());
    root.querySelectorAll('[data-action="export"]').forEach((button)=>button.addEventListener("click",()=>this.exportLibrary()));
    root.querySelector('[data-action="import"]')?.addEventListener("click",()=>this.importLibrary());
    root.querySelector('[data-action="prev-page"]')?.addEventListener("click",()=>{this.managerPage=Math.max(0,this.managerPage-1);this.renderManager();});
    root.querySelector('[data-action="next-page"]')?.addEventListener("click",()=>{this.managerPage+=1;this.renderManager();});
    this.bindSectionTabs(root);
  }
  bindRowActions(row) {
    const word=this.state.words.find((item)=>item.id===row.dataset.wordId); if(!word)return;
    row.querySelector('[data-action="speak"]')?.addEventListener("click",()=>this.speak(word.word));
    row.querySelector('[data-action="master"]')?.addEventListener("click",()=>this.toggleMastered(word.id));
    row.querySelector('[data-action="edit"]')?.addEventListener("click",()=>this.openWordDialog(word));
    row.querySelector('[data-action="delete"]')?.addEventListener("click",async()=>{if(!window.confirm(`将“${word.word}”移到回收站？`))return;deleteWordState(this.state,word.id);await this.commitChange("已移到回收站");});
  }
  bindBookActions(row) {
    const book=this.state.books.find((item)=>item.id===row.dataset.bookId);if(!book)return;
    row.querySelector('[data-action="edit-book"]')?.addEventListener("click",()=>this.openBookDialog(book));
    row.querySelector('[data-action="toggle-book"]')?.addEventListener("click",async()=>{book.enabled=book.enabled===false;book.updatedAt=nowISO();await this.commitChange(book.enabled?"生词本已启用":"生词本已停用");});
    row.querySelector('[data-action="archive-book"]')?.addEventListener("click",async()=>{book.archived=!book.archived;book.updatedAt=nowISO();await this.commitChange(book.archived?"生词本已归档":"已取消归档");});
    row.querySelector('[data-action="delete-book"]')?.addEventListener("click",async()=>{if(!window.confirm(`删除“${book.name}”？其中词条会移到默认生词本。`))return;this.state.words.forEach((word)=>{if(word.bookId===book.id)word.bookId="default";});this.state.books=this.state.books.filter((item)=>item.id!==book.id);if(this.managerBook===book.id)this.managerBook="all";await this.commitChange("生词本已删除，词条已移到默认生词本");});
  }
  bindRecycleActions(row) {
    const id=row.dataset.recycleId;
    row.querySelector('[data-action="restore-word"]')?.addEventListener("click",async()=>{if(!restoreWordState(this.state,id))return showMessage("恢复失败：当前词库已有同名单词",4000,"error");await this.commitChange("词条已恢复");});
    row.querySelector('[data-action="purge-word"]')?.addEventListener("click",async()=>{const item=this.state.recycleBin.find((entry)=>entry.word.id===id);if(!item||!window.confirm(`永久删除“${item.word.word}”？此操作不可恢复。`))return;this.state.recycleBin=this.state.recycleBin.filter((entry)=>entry.word.id!==id);await this.commitChange("词条已永久删除");});
  }  async saveEditor() {
    this.syncDraftFromForm(); const draft=this.editorDraft; if(!draft?.word)return showMessage("单词不能为空");
    draft.key=canonicalKey(draft.word); draft.aliases=normalizeAliases(draft.aliases);
    const existingById=this.state.words.findIndex((word)=>word.id===draft.id);
    const duplicate=this.state.words.find((word)=>word.key===draft.key&&word.id!==draft.id);
    if(duplicate){this.setEditorDraft(duplicate);this.renderManager();return showMessage("该单词已存在，已打开原词条",4000,"error");}
    const draftKeys=new Set([draft.key,...draft.aliases.map(canonicalKey)]);
    const aliasConflict=this.state.words.find((word)=>word.id!==draft.id&&[word.word,...word.aliases].map(canonicalKey).some((key)=>draftKeys.has(key)));
    if(aliasConflict&&!window.confirm(`“${draft.word}”与“${aliasConflict.word}”的主词或别名冲突，仍然保存？`))return;
    draft.updatedAt=nowISO(); if(!draft.createdAt)draft.createdAt=draft.updatedAt;
    draft.masteredAt=draft.mastered?(draft.masteredAt||nowISO()):"";
    if(existingById>=0)this.state.words.splice(existingById,1,normalizeWord(draft));else this.state.words.push(normalizeWord(draft));
    this.state.settings.currentBookId=draft.bookId;this.setEditorDraft(null);await this.commitChange(existingById>=0?"生词已更新":"已加入生词本");
  }
  async fillEditorWithAI(event) {
    this.syncDraftFromForm();if(!this.editorDraft?.word)return showMessage("请先输入单词或短语");
    const status=this.managerRoot?.querySelector('[data-role="editor-status"]');event.currentTarget.disabled=true;if(status)status.textContent="正在生成上下文释义…";
    try{this.editorDraft.definition=await this.generateDefinition(this.editorDraft.word,this.editorDraft.sentence,this.editorDraft.language);this.editorDraft.rawDefinition=this.editorDraft.definition;this.editorDraft.sections=parseDefinitionSections(this.editorDraft.definition);this.editorOriginal="__dirty__";this.renderManager();const next=this.managerRoot?.querySelector('[data-role="editor-status"]');if(next)next.textContent="AI 释义已生成，请检查后保存。";}
    catch(error){if(status)status.textContent=`生成失败：${error.message||error}`;}
    finally{if(event.currentTarget?.isConnected)event.currentTarget.disabled=false;}
  }
  async saveSetting(control) {
    const key=control.dataset.setting;
    const previousValue=this.state.settings[key];
    let value=control.type==="checkbox"?control.checked:control.value;
    if(control.type==="number")value=Number(value);
    if(key==="ttsTemplate"&&value){try{safeTtsUrl(value,"test");}catch(error){showMessage(error.message,4500,"error");this.renderManager();return;}}
    if(key==="aiApiUrl"&&value){try{safeRemoteUrl(value,"API 地址");}catch(error){showMessage(error.message,4500,"error");this.renderManager();return;}}
    if(key==="aiPrompt"&&!String(value).includes("{{word}}")){showMessage("释义提示词必须包含 {{word}}",4500,"error");this.renderManager();return;}
    if(key==="translatePrompt"&&(!String(value).includes("{{text}}")||(!String(value).includes("{{to}}")&&!String(value).includes("{{targetLang}}")))){showMessage("翻译提示词必须包含 {{text}} 和 {{to}}",4500,"error");this.renderManager();return;}
    if(key==="aiExtraParams"){try{mergeExtraParams({},String(value));}catch(error){showMessage(error.message,5000,"error");this.renderManager();return;}}
    if(key==="aiRetries")value=Math.max(0,Math.min(2,Number(value)||0));
    if(key==="aiCacheMinutes")value=Math.max(0,Math.min(1440,Number(value)||0));
    this.state.settings[key]=value;
    if(key==="enableSelectionTranslate")this.state.settings.selectionTranslate.enabled=Boolean(value);
    if(key==="translateTargetLang")this.state.settings.selectionTranslate.targetLang=String(value||"zh-CN");
    if(key==="translatePrompt")this.state.settings.selectionTranslate.prompt=String(value||DEFAULT_TRANSLATE_PROMPT);
    if(key==="aiProvider"&&value!=="custom"&&previousValue!==value){
      const defaults=AI_PROVIDER_DEFAULTS[value];
      if(defaults){
        this.state.settings.aiApiUrl=defaults.apiUrl;
        this.state.settings.aiModel=defaults.model;
        const settingsRoot=control.closest(".siwords-settings");
        const apiUrlControl=settingsRoot?.querySelector('[data-setting="aiApiUrl"]');
        const modelControl=settingsRoot?.querySelector('[data-setting="aiModel"]');
        if(apiUrlControl)apiUrlControl.value=defaults.apiUrl;
        if(modelControl)modelControl.value=defaults.model;
      }
    }
    if(["aiProvider","aiApiUrl","aiModel","aiPrompt","aiExtraParams","translateTargetLang","translatePrompt"].includes(key))this.aiCache.clear();
    this.rebuildMatcher();await this.saveState("设置已保存");this.renderDock();this.applyHighlightStyle();this.scheduleRefresh(30);
    if(["aiSource","scopeMode"].includes(key))this.renderManager();
    showMessage("设置已保存");
  }
  async saveSecret(control) {
    if (control.dataset.secret !== "apiKey") return;
    this.secrets.apiKey = String(control.value || "").trim();
    await this.saveSecrets();
    showMessage("API Key 已单独保存在插件数据中");
  }  openBookDialog(existing=null) {
    const dialog=new Dialog({title:existing?"编辑生词本":"新建生词本",content:`<div class="siwords-form siwords-ui"><label>名称<input class="b3-text-field" data-field="name" value="${escapeHTML(existing?.name||"")}"></label><label>颜色<select class="b3-select" data-field="color">${Object.keys(COLORS).map((id)=>`<option value="${id}" ${id===(existing?.color||"2")?"selected":""}>● 颜色 ${id}</option>`).join("")}</select></label><div class="siwords-form__actions"><span class="fn__flex-1"></span><button class="b3-button b3-button--cancel" data-action="cancel">取消</button><button class="b3-button b3-button--text" data-action="save">保存</button></div></div>`,width:"440px"});
    const root=dialog.element.querySelector(".siwords-form");
    root.querySelector('[data-action="cancel"]').addEventListener("click",()=>dialog.destroy());
    root.querySelector('[data-action="save"]').addEventListener("click",async()=>{
      const name=root.querySelector('[data-field="name"]').value.trim();if(!name)return showMessage("生词本名称不能为空");
      const duplicate=this.state.books.find((book)=>book.name===name&&book.id!==existing?.id);if(duplicate)return showMessage("已经存在同名生词本",3500,"error");
      if(existing){existing.name=name;existing.color=root.querySelector('[data-field="color"]').value;existing.updatedAt=nowISO();}
      else this.state.books.push(normalizeBook({name,color:root.querySelector('[data-field="color"]').value,order:this.state.books.length}));
      await this.commitChange(existing?"生词本已更新":"生词本已创建");dialog.destroy();
    });
  }
  exportLibrary() {
    const blob=new Blob([JSON.stringify(this.state,null,2)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`siwords-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);showMessage("SiWords 完整词库已导出");
  }
  importLibrary() {
    const input=document.createElement("input");input.type="file";input.accept="application/json,.json";
    input.addEventListener("change",async()=>{const file=input.files?.[0];if(!file)return;try{
      const parsed=JSON.parse(await file.text());const rawValidation=validateRawState(parsed);if(!rawValidation.ok)throw new Error(rawValidation.errors.join("；"));
      const next=normalizeState(parsed);const validation=validateState(next);if(!validation.ok)throw new Error(validation.errors.join("；"));
      if(!window.confirm(`导入 ${next.words.length} 个词和 ${next.books.length} 个生词本？当前词库会先备份。`))return;
      await this.createBackup("导入前自动备份");this.state=next;this.storageQuarantined=false;this.rebuildMatcher();await this.saveState("导入词库");this.afterVisualChange();showMessage("SiWords 词库导入完成");
    }catch(error){showMessage(`导入失败：${error.message||error}`,6000,"error");}});input.click();
  }
  async runSelfTest() {
    const cached=await this.safeLoad("siwords-selftest.json");
    if(cached?.version===PLUGIN_VERSION&&cached?.passed)return{...cached,reused:true};
    const report = { version: PLUGIN_VERSION, at: nowISO(), passed: false, checks: {}, errors: [] };
    const previous = { root: this.managerRoot, draft: this.editorDraft, original: this.editorOriginal, view: this.managerView };
    let host;
    try {
      report.checks.dom = Boolean(document?.body && document.createElement && typeof Range === "function");
      report.checks.cssHighlights = Boolean(globalThis.CSS?.highlights && globalThis.Highlight);
      report.checks.matcherBoundary = findTermMatches("artist art take off", buildMatcher([{ id: "a", word: "art", aliases: [] }, { id: "b", word: "take off", aliases: [] }])).map((item) => item.term).join("|") === "art|take off";
      const surface = document.createElement("div"); surface.className = "textLayer"; surface.innerHTML = "<span>take </span><span>off safely</span>"; document.body.appendChild(surface);
      const map = this.collectTextMap(surface); const match = findTermMatches(map.text, buildMatcher([{ id: "p", word: "take off", aliases: [] }]))[0]; const range = match ? this.rangeForMatch(map, match) : null;
      report.checks.crossNodeRange = Boolean(range && range.toString() === "take off" && range.startContainer !== range.endContainer); surface.remove();
      host = document.createElement("div"); host.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:700px"; document.body.appendChild(host);
      this.managerRoot = host; this.managerView = "about"; this.setEditorDraft(null); this.renderManager();
      report.checks.managerRender = Boolean(host.querySelector(".siwords-page") && host.querySelector('[data-action="new-word"]'));
      const openaiShape = buildAIRequest({ provider: "openai-compatible", apiUrl: "https://example.com/v1", apiKey: "test", model: "mock" }, "OK");
      const claudeShape = buildAIRequest({ provider: "anthropic", apiUrl: "https://api.anthropic.com", apiKey: "test", model: "mock" }, "OK");
      const geminiShape = buildAIRequest({ provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "test", model: "mock" }, "OK");
      report.checks.aiRequestShapes = openaiShape.endpoint.endsWith("/chat/completions") && claudeShape.endpoint.endsWith("/v1/messages") && geminiShape.endpoint.includes(":generateContent");
      report.checks.markdownSafe = !renderMarkdown("<script>x</script>").includes("<script>");
      report.passed = ["dom", "cssHighlights", "matcherBoundary", "crossNodeRange", "managerRender", "aiRequestShapes", "markdownSafe"].every((key) => report.checks[key]);
    } catch (error) { report.errors.push(String(error?.stack || error)); }
    finally {
      host?.remove(); this.managerRoot = previous.root; this.editorDraft = previous.draft; this.editorOriginal = previous.original; this.managerView = previous.view;
      try { await this.saveData("siwords-selftest.json", report); } catch (error) { report.errors.push(`保存自检报告失败：${error.message || error}`); }
    }
    if (!report.passed) showMessage("SiWords 自检未完全通过，请查看运行报告", 5000, "error");
    return report;
  }
  applyHighlightStyle() {
    let style=document.getElementById("siwords-highlight-style");
    if(!style){style=document.createElement("style");style.id="siwords-highlight-style";document.head.appendChild(style);}
    const mode=this.state.settings.highlightStyle;
    style.textContent=Object.entries(COLORS).map(([id,color])=>{
      if(mode==="background")return `::highlight(siwords-${id}){background:${color}45;color:inherit}`;
      if(mode==="bold")return `::highlight(siwords-${id}){font-weight:700;text-decoration:underline 2px ${color}}`;
      if(mode==="wavy")return `::highlight(siwords-${id}){text-decoration:underline wavy 1.5px ${color};text-underline-offset:3px}`;
      if(mode==="dotted")return `::highlight(siwords-${id}){text-decoration:underline dotted 2px ${color};text-underline-offset:3px}`;
      return `::highlight(siwords-${id}){text-decoration:underline 2px ${color};text-underline-offset:3px;background:${color}18}`;
    }).join("\n");
  }
  scheduleRefresh(delay=260){
    if(this.refreshTimer||this.refreshIdle!=null)return;
    this.refreshTimer=window.setTimeout(()=>{
      this.refreshTimer=null;
      const run=()=>{this.refreshIdle=null;this.refreshHighlights();};
      if(typeof window.requestIdleCallback==="function")this.refreshIdle=window.requestIdleCallback(run,{timeout:800});
      else run();
    },Math.max(0,Number(delay)||0));
  }
  clearHighlights(){if(globalThis.CSS?.highlights)Object.keys(COLORS).forEach((id)=>CSS.highlights.delete(`siwords-${id}`));}
  invalidateSurfaceCache(root=null){
    if(root&&this.surfaceCache?.delete)this.surfaceCache.delete(root);
    else this.surfaceCache=new WeakMap();
    this.hoverScopeCache=new WeakMap();
    this.activePopoverHitRects=[];
  }
  visibleRoots(){
    const all=[...document.querySelectorAll(".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer")].filter((root)=>root.offsetParent!==null);
    return all.filter((root,index)=>!all.some((other,i)=>i!==index&&other.contains(root)));
  }
  activeSurfaceRoot(){
    const selector=".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer";
    const focused=document.activeElement?.closest?.(selector);
    if(focused)return focused;
    const activeWindow=document.querySelector(".layout__wnd--active");
    const active=activeWindow?.querySelector?.(selector);
    if(active)return active;
    const activeTab=document.querySelector(".layout-tab-container .item--focus")?.closest?.(".layout-tab-container")?.querySelector?.(selector);
    return activeTab||this.visibleRoots()[0]||document.querySelector(selector)||null;
  }
  surfaceInfo(root){
    if(!root)return{docId:"",title:"",path:"",box:"",pdfPage:0};
    const protyle=root.closest?.(".protyle");
    const titleNode=protyle?.querySelector?.(".protyle-title__input");
    const docId=String(root.dataset?.docId||titleNode?.getAttribute?.("data-node-id")||protyle?.dataset?.id||root.closest?.("[data-node-id]")?.getAttribute?.("data-node-id")||"");
    const title=String(titleNode?.textContent||protyle?.dataset?.title||document.title||"").trim();
    const page=root.closest?.(".page");
    return{
      docId,
      title,
      path:String(root.dataset?.path||protyle?.dataset?.path||titleNode?.dataset?.path||""),
      box:String(root.dataset?.box||protyle?.dataset?.box||titleNode?.dataset?.box||""),
      pdfPage:Number(page?.dataset?.pageNumber||0)||0,
    };
  }
  surfaceDocId(root){return this.surfaceInfo(root).docId;}
  surfaceAllowed(root){return isDocumentInScope(this.surfaceInfo(root),this.state.settings);}
  collectTextMap(root){
    const segments=[];const segmentByNode=new WeakMap();let text="";let lastBlock="";
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:(node)=>{
      const parent=node.parentElement;
      if(!node.nodeValue?.trim()||!parent||parent.closest(".siwords-ui,script,style,textarea,input,.protyle-attr"))return NodeFilter.FILTER_REJECT;
      if(!this.state.settings.highlightCode&&parent.closest("code,pre,.hljs"))return NodeFilter.FILTER_REJECT;
      if(!this.state.settings.highlightLinks&&parent.closest("a"))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    let node;
    while((node=walker.nextNode())){
      const block=node.parentElement?.closest?.("[data-node-id],.textLayer .text");
      const blockId=block?.getAttribute?.("data-node-id")||block?.dataset?.index||"";
      if(text&&blockId&&lastBlock&&blockId!==lastBlock)text+="\n";
      const start=text.length;text+=node.nodeValue;
      const segment={node,start,end:text.length};segments.push(segment);segmentByNode.set(node,segment);lastBlock=blockId||lastBlock;
    }
    return{text,segments,segmentByNode};
  }
  getSurfaceRecord(root){
    if(!root)return null;
    const cached=this.surfaceCache?.get?.(root);
    if(cached)return cached;
    const map=this.collectTextMap(root);
    const record={at:Date.now(),map,matches:findTermMatches(map.text,this.matcher)};
    this.surfaceCache?.set?.(root,record);
    return record;
  }
  segmentAtOffset(segments,offset){
    let low=0,high=segments.length-1;
    while(low<=high){
      const middle=(low+high)>>1;const segment=segments[middle];
      if(offset<segment.start)high=middle-1;
      else if(offset>=segment.end)low=middle+1;
      else return segment;
    }
    return null;
  }
  rangeForMatch(map,match){
    const start=this.segmentAtOffset(map.segments,match.start);
    const end=this.segmentAtOffset(map.segments,match.end-1);
    if(!start||!end)return null;
    try{const range=new Range();range.setStart(start.node,match.start-start.start);range.setEnd(end.node,match.end-end.start);return range;}catch(_){return null;}
  }
  rangesForMatch(map,match){
    const parts=Array.isArray(match.segments)&&match.segments.length?match.segments:[{start:match.start,end:match.end}];
    return parts.map((part)=>this.rangeForMatch(map,part)).filter(Boolean);
  }
  matchAtPoint(matches,point){
    let low=0;let high=matches.length-1;
    while(low<=high){
      const middle=(low+high)>>1;const match=matches[middle];
      if(point<match.start)high=middle-1;
      else if(point>=match.end)low=middle+1;
      else{
        const parts=Array.isArray(match.segments)&&match.segments.length?match.segments:[match];
        return parts.some((part)=>point>=part.start&&point<part.end)?match:null;
      }
    }
    return null;
  }
  hoverScopeFor(element,root){
    const block=element?.closest?.("[data-node-id]");
    if(block&&root?.contains?.(block))return block;
    const page=element?.closest?.(".page");
    const layer=page?.querySelector?.(".textLayer");
    if(layer&&root?.contains?.(layer))return layer;
    return root;
  }
  findSurfaceMatchAtRange(root,range,localScope=null){
    if(!root||!range)return null;
    let record=this.surfaceCache?.get?.(root)||null;
    if(!record&&localScope){
      record=this.hoverScopeCache?.get?.(localScope)||null;
      if(!record){
        const map=this.collectTextMap(localScope);
        record={at:Date.now(),map,matches:findTermMatches(map.text,this.matcher),local:true};
        this.hoverScopeCache||=new WeakMap();this.hoverScopeCache.set(localScope,record);
      }
    }
    if(!record)record=this.getSurfaceRecord(root);
    if(!record)return null;
    const segment=record.map.segmentByNode?.get?.(range.startContainer)||record.map.segments.find((item)=>item.node===range.startContainer);
    if(!segment)return null;
    const point=segment.start+Math.max(0,Number(range.startOffset)||0);
    const match=this.matchAtPoint(record.matches,point);
    return match?{...match,hitRanges:this.rangesForMatch(record.map,match)}:null;
  }
  refreshHighlights(){
    this.clearHighlights();this.refreshDockForSurface();
    if(!this.state.settings.enableAutoHighlight||!globalThis.CSS?.highlights||!globalThis.Highlight)return;
    if(!this.activeWords().length)return;
    const byColor=new Map(Object.keys(COLORS).map((id)=>[id,[]]));
    for(const root of this.visibleRoots()){
      if(!this.surfaceAllowed(root))continue;
      const record=this.getSurfaceRecord(root);if(!record)continue;
      for(const match of record.matches)for(const range of this.rangesForMatch(record.map,match))byColor.get(this.entryColor(match.entry)).push(range);
    }
    for(const[color,ranges]of byColor)if(ranges.length)CSS.highlights.set(`siwords-${color}`,new Highlight(...ranges));
  }
  isSurface(target){return target instanceof Element&&Boolean(target.closest(".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer"));}
  selectedContext(){
    const selection=window.getSelection();const text=selection?.toString().trim()||"";
    if(!selection||!text||selection.rangeCount<1)return null;
    const range=selection.getRangeAt(0);
    const element=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    if(!this.isSurface(element))return null;
    const root=element.closest?.(".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer");
    const block=element?.closest?.("[data-node-id]");const page=element?.closest?.(".page");const blockText=block?.textContent||range.commonAncestorContainer.textContent||text;
    let offset=range.startOffset;
    try{if(block){const before=range.cloneRange();before.selectNodeContents(block);before.setEnd(range.startContainer,range.startOffset);offset=before.toString().length;}}catch(_){}
    const info=this.surfaceInfo(root);
    return{text,range,sentence:extractSentence(blockText,offset),sourceDocId:info.docId,sourceBlockId:block?.getAttribute("data-node-id")||"",sourceTitle:info.title,sourcePath:info.path,sourceBox:info.box,sourcePdfPage:Number(page?.dataset?.pageNumber||info.pdfPage||0)};
  }
  addCurrentSelection(){
    const context=this.selectedContext();
    if(!context)return showMessage("请先在思源文档或 PDF 中选中单词或短语");
    if(context.text.length>120)return showMessage("选中文本过长，请选择一个单词或短语");
    this.openWordEditor(context.text,context.sentence,context);
  }
  onOpenMenuContent(event){
    const context=this.selectedContext();const menu=event?.detail?.menu;
    if(!context||!menu?.addItem)return;
    menu.addItem({icon:"iconSiWordsAdd",label:"添加到 SiWords 生词本",click:()=>this.openWordEditor(context.text,context.sentence,context)});
  }
  onMouseUp(event){
    if(event.button!==0||event.target?.closest?.(".siwords-ui,.hi-words-highlight"))return;
    this.updateSelectionState();
    this.cancelHoverInspection();
    this.hidePopover();
    this.cancelSelectionIntent();
    this.suppressHoverUntil=Date.now()+350;
    this.selectionTimer=window.setTimeout(()=>{
      this.selectionTimer=null;
      const context=this.selectedContext();this.removeFloat();
      if(!context)return;
      const rects=[...context.range.getClientRects()].filter((item)=>item.width||item.height);
      const rect=rects.at(-1)||context.range.getBoundingClientRect();
      if(!rect.width&&!rect.height)return;
      const canTranslate=this.state.settings.enableSelectionTranslate&&this.state.settings.aiEnabled&&context.text.length<=500;
      if(canTranslate){this.showTranslationPopover(context,rect);return;}
      if(!this.state.settings.showSelectionButton||context.text.length>120)return;
      const host=document.createElement("div");host.className="siwords-float siwords-ui";
      host.innerHTML='<button type="button" data-action="selection-add">＋ 生词</button>';
      host.addEventListener("mousedown",(e)=>e.preventDefault());
      host.querySelector("button").addEventListener("click",()=>{this.removeFloat();this.openWordEditor(context.text,context.sentence,context);});
      document.body.appendChild(host);
      const anchorX=Math.max(8,rect.right-72);const anchorY=rect.bottom;
      const options={alignStart:true,gap:7};
      const placed=this.provisionalFloatingElement(host,anchorX,anchorY,{...options,estimatedWidth:100,estimatedHeight:44});
      this.observeFloatingElement(host,anchorX,anchorY,{...options,placement:placed?.placement});
    },50);
  }
  removeFloat(){document.querySelectorAll(".siwords-float").forEach((item)=>this.disposeFloatingElement(item));}
  cancelHoverInspection(){
    if(this.hoverTimer)window.clearTimeout(this.hoverTimer);
    this.hoverTimer=null;this.hoverPointer=null;this.hoverOrigin=null;
  }
  cancelSelectionIntent(){
    if(this.selectionTimer)window.clearTimeout(this.selectionTimer);
    this.selectionTimer=null;
  }
  updateSelectionState(){
    const selection=window.getSelection?.();
    this.selectionActive=Boolean(selection&&selection.rangeCount>0&&!selection.isCollapsed);
    return this.selectionActive;
  }
  onSelectionChange(){
    if(this.updateSelectionState()){
      this.cancelHoverInspection();this.hidePopover();
    }
  }
  hasActiveSelection(){return Boolean(this.selectionActive);}
  onViewportChange(event){
    const target=event?.target;
    if(event?.type==="resize")this.captureViewportMetrics();
    if(event?.type==="scroll"&&target instanceof Element&&target.closest(".siwords-popover,.siwords-translate-popover,.siwords-float"))return;
    this.cancelHoverInspection();this.cancelSelectionIntent();this.hidePopover();this.hideTranslationPopover();this.removeFloat();
  }
  onMouseDown(event){
    this.selectionActive=false;
    if(!event.target?.closest?.(".siwords-ui"))this.cancelSelectionIntent();
    if(!event.target?.closest?.(".siwords-float"))this.removeFloat();
    if(!event.target?.closest?.(".siwords-popover")){this.cancelHoverInspection();this.hidePopover();}
    if(!event.target?.closest?.(".siwords-translate-popover"))this.hideTranslationPopover();
  }
  onPointerMove(event){
    const target=event.target;
    if(target?.closest?.(".siwords-popover,.siwords-translate-popover,.siwords-float")){
      this.cancelHoverInspection();
      if(this.hideTimer)window.clearTimeout(this.hideTimer);
      this.hideTimer=null;
      return;
    }
    const nonMouse=Boolean(event.pointerType&&event.pointerType!=="mouse");
    const blocked=event.buttons!==0||nonMouse||Date.now()<Number(this.suppressHoverUntil||0)||!this.state.settings.showDefinitionOnHover||!this.isSurface(target)||this.hasActiveSelection();
    if(blocked){
      this.cancelHoverInspection();
      if(this.activePopoverElement?.isConnected)this.hidePopoverSoon();
      return;
    }
    const next={x:event.clientX,y:event.clientY};
    if(this.hoverTimer&&this.hoverOrigin&&Math.hypot(next.x-this.hoverOrigin.x,next.y-this.hoverOrigin.y)<=7){
      this.hoverPointer=next;
      return;
    }
    this.cancelHoverInspection();
    this.hoverOrigin=next;this.hoverPointer=next;
    this.hoverTimer=window.setTimeout(()=>{
      const point=this.hoverPointer;this.hoverTimer=null;this.hoverPointer=null;this.hoverOrigin=null;
      if(point)this.inspectPoint(point.x,point.y);
    },Math.max(80,Number(this.state.settings.hoverDelay)||180));
  }
  inspectPoint(x,y){
    if(this.hasActiveSelection()){this.hidePopoverSoon();return null;}
    const existing=this.activePopoverElement?.isConnected?this.activePopoverElement:null;
    const cachedPointerRect=existing&&this.activePopoverWordId&&this.activePopoverHitRects?.find?.((rect)=>x>=rect.left-2&&x<=rect.right+2&&y>=rect.top-2&&y<=rect.bottom+2);
    if(cachedPointerRect){
      if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;
      return existing;
    }
    const range=document.caretRangeFromPoint?.(x,y);
    if(!range||range.startContainer.nodeType!==Node.TEXT_NODE){this.hidePopoverSoon();return null;}
    const element=range.startContainer.parentElement;
    const root=element?.closest?.(".protyle-wysiwyg,.pdfViewer .textLayer,.pdf__viewer .textLayer");
    const match=this.findSurfaceMatchAtRange(root,range,this.hoverScopeFor(element,root));
    let pointerRect=null;const hitRects=[];
    for(const hitRange of match?.hitRanges||[]){
      for(const rect of hitRange.getClientRects()){
        const snapshot={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
        hitRects.push(snapshot);
        if(x>=snapshot.left-2&&x<=snapshot.right+2&&y>=snapshot.top-2&&y<=snapshot.bottom+2)pointerRect=snapshot;
      }
    }
    if(!match||!pointerRect){this.hidePopoverSoon();return null;}
    const anchorX=pointerRect.left;const anchorY=pointerRect.bottom;
    if(existing&&this.activePopoverWordId===match.entry.id){
      this.activePopoverHitRects=hitRects;
      if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;
      const anchor=existing.__siwordsFloatingAnchor;
      if(!anchor||Math.hypot(Number(anchor.anchorX)-anchorX,Number(anchor.anchorY)-anchorY)>64)this.updateFloatingAnchor(existing,anchorX,anchorY);
      return existing;
    }
    const popover=this.showPopover(match.entry,anchorX,anchorY);
    this.activePopoverHitRects=hitRects;
    return popover;
  }
  hidePopoverSoon(){
    if(this.hideTimer)return;
    this.hideTimer=window.setTimeout(()=>{this.hideTimer=null;this.hidePopover();},320);
  }
  hidePopover(){
    if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;
    if(this.activePopoverElement)this.disposeFloatingElement(this.activePopoverElement);
    this.activePopoverElement=null;this.activePopoverWordId="";this.activePopoverHitRects=[];
  }
  definitionHTML(word){
    const raw=String(word?.rawDefinition??word?.definition??"");
    const sections=Array.isArray(word?.sections)&&word.sections.length?word.sections:parseDefinitionSections(raw);
    const key=JSON.stringify([word?.id||word?.word||"",word?.updatedAt||"",raw,this.state.settings.enableSectionTabs!==false,this.state.settings.blurDefinitions===true]);
    const cached=this.definitionCache?.get?.(key);
    if(cached!==undefined){this.definitionCache.delete(key);this.definitionCache.set(key,cached);return cached;}
    const html=!this.state.settings.enableSectionTabs||sections.length<2
      ?`<div class="siwords-definition ${this.state.settings.blurDefinitions?"is-blurred":""}">${renderMarkdown(raw)}</div>`
      :`<div class="siwords-section-tabs" role="tablist">${sections.map((section,index)=>`<button type="button" class="siwords-section-tab ${index===0?"is-active":""}" data-section-index="${index}" role="tab" aria-selected="${index===0?"true":"false"}">${escapeHTML(section.title)}</button>`).join("")}</div><div class="siwords-section-panels">${sections.map((section,index)=>`<div class="siwords-section-panel siwords-definition ${this.state.settings.blurDefinitions?"is-blurred":""}" data-section-panel="${index}" ${index===0?"":"hidden"}>${renderMarkdown(section.content)}</div>`).join("")}</div>`;
    this.definitionCache||=new Map();this.definitionCache.set(key,html);
    while(this.definitionCache.size>600)this.definitionCache.delete(this.definitionCache.keys().next().value);
    return html;
  }
  bindSectionTabs(root){
    root?.querySelectorAll?.(".siwords-section-tab").forEach((button)=>button.addEventListener("click",()=>{
      const host=button.closest(".siwords-popover,.siwords-card,.siwords-library-word")||root;
      const index=button.dataset.sectionIndex;
      host.querySelectorAll(".siwords-section-tab").forEach((item)=>{const active=item===button;item.classList.toggle("is-active",active);item.setAttribute("aria-selected",active?"true":"false");});
      host.querySelectorAll("[data-section-panel]").forEach((panel)=>{panel.hidden=panel.dataset.sectionPanel!==index;});
    }));
  }
  fallbackViewportMetrics(){
    const width=Math.max(320,Number(globalThis.screen?.availWidth)||1024);
    const height=Math.max(240,Number(globalThis.screen?.availHeight)||768);
    return {left:0,top:0,width,height,right:width,bottom:height};
  }
  captureViewportMetrics(){
    if(typeof window==="undefined")return this.viewportMetrics||this.fallbackViewportMetrics();
    const fallback=this.fallbackViewportMetrics();
    const viewport=window.visualViewport;
    const left=Number(viewport?.offsetLeft)||0;
    const top=Number(viewport?.offsetTop)||0;
    const width=Math.max(1,Number(viewport?.width)||Number(window.innerWidth)||fallback.width);
    const height=Math.max(1,Number(viewport?.height)||Number(window.innerHeight)||fallback.height);
    this.viewportMetrics={left,top,width,height,right:left+width,bottom:top+height};
    return this.viewportMetrics;
  }
  currentViewportMetrics(){return this.viewportMetrics||this.fallbackViewportMetrics();}
  provisionalFloatingElement(element,anchorX,anchorY,options={}){
    if(!element)return null;
    const margin=Math.max(8,Number(options.margin)||10);
    const gap=Math.max(6,Number(options.gap)||12);
    const metrics=this.currentViewportMetrics();
    const viewportLeft=metrics.left;const viewportTop=metrics.top;
    const viewportWidth=metrics.width;const viewportHeight=metrics.height;
    const viewportRight=metrics.right;const viewportBottom=metrics.bottom;
    const x=Number.isFinite(Number(anchorX))?Number(anchorX):viewportLeft+margin;
    const y=Number.isFinite(Number(anchorY))?Number(anchorY):viewportTop+margin;
    const estimatedWidth=Math.min(Math.max(40,Number(options.estimatedWidth)||360),Math.max(40,viewportWidth-margin*2));
    const estimatedHeight=Math.min(Math.max(32,Number(options.estimatedHeight)||Number(options.reserveHeight)||360),Math.max(32,viewportHeight-margin*2));
    let left=options.alignStart?x:x+gap;
    if(left+estimatedWidth>viewportRight-margin)left=options.alignStart?viewportRight-margin-estimatedWidth:x-estimatedWidth-gap;
    left=Math.max(viewportLeft+margin,Math.min(left,viewportRight-margin-estimatedWidth));
    const placement=options.placement==="above"||options.placement==="below"?options.placement:(y+gap+estimatedHeight<=viewportBottom-margin?"below":"above");
    element.style.position="fixed";
    element.style.left=`${Math.round(left)}px`;
    if(placement==="above"){
      element.style.top=`${Math.round(Math.max(viewportTop+margin,y-gap))}px`;
      element.style.transform="translateY(-100%)";
    }else{
      element.style.top=`${Math.round(Math.max(viewportTop+margin,y+gap))}px`;
      element.style.transform="none";
    }
    element.style.visibility="";
    element.dataset.placement=placement;
    return {left,top:y,width:estimatedWidth,height:estimatedHeight,placement,provisional:true};
  }
  positionFloatingElement(element,anchorX,anchorY,options={}){
    if(!element)return null;
    const margin=Math.max(8,Number(options.margin)||10);
    const gap=Math.max(6,Number(options.gap)||12);
    const metrics=this.currentViewportMetrics();
    const viewportLeft=metrics.left;const viewportTop=metrics.top;
    const viewportWidth=metrics.width;const viewportHeight=metrics.height;
    const viewportRight=metrics.right;const viewportBottom=metrics.bottom;
    const x=Number.isFinite(Number(anchorX))?Number(anchorX):viewportLeft+margin;
    const y=Number.isFinite(Number(anchorY))?Number(anchorY):viewportTop+margin;
    element.style.visibility="hidden";
    element.style.transform="none";
    element.style.left=`${viewportLeft+margin}px`;
    element.style.top=`${viewportTop+margin}px`;
    if(!element.isConnected)document.body.appendChild(element);
    const measured=element.getBoundingClientRect();
    const width=Math.min(measured.width,Math.max(0,viewportWidth-margin*2));
    const height=Math.min(measured.height,Math.max(0,viewportHeight-margin*2));
    let left=options.alignStart?x:x+gap;
    if(left+width>viewportRight-margin)left=options.alignStart?viewportRight-margin-width:x-width-gap;
    left=Math.max(viewportLeft+margin,Math.min(left,viewportRight-margin-width));
    const reserveHeight=Math.max(height,Math.min(viewportHeight-margin*2,Number(options.reserveHeight)||0));
    const placement=options.placement==="above"||options.placement==="below"?options.placement:(y+gap+reserveHeight<=viewportBottom-margin?"below":"above");
    let top=placement==="above"?y-height-gap:y+gap;
    top=Math.max(viewportTop+margin,Math.min(top,viewportBottom-margin-height));
    element.style.left=`${Math.round(left)}px`;
    element.style.top=`${Math.round(top)}px`;
    element.style.visibility="";
    element.dataset.placement=placement;
    return {left,top,width,height,placement};
  }
  observeFloatingElement(element,anchorX,anchorY,options={}){
    if(!element)return;
    element.__siwordsFloatingAnchor={anchorX,anchorY,options};
    const reposition=()=>{
      if(element.__siwordsRepositionFrame)return;
      element.__siwordsRepositionFrame=window.requestAnimationFrame(()=>{
        element.__siwordsRepositionFrame=0;
        if(!element.isConnected){element.__siwordsResizeObserver?.disconnect();return;}
        const anchor=element.__siwordsFloatingAnchor;
        if(anchor)this.positionFloatingElement(element,anchor.anchorX,anchor.anchorY,anchor.options);
      });
    };
    element.__siwordsResizeObserver?.disconnect();
    if(typeof ResizeObserver!=="undefined"){
      const observer=new ResizeObserver(reposition);
      element.__siwordsResizeObserver=observer;
      observer.observe(element);
    }
  }
  updateFloatingAnchor(element,anchorX,anchorY,options=undefined){
    if(!element)return null;
    const current=element.__siwordsFloatingAnchor||{};
    const nextOptions=options??current.options??{};
    element.__siwordsFloatingAnchor={anchorX,anchorY,options:nextOptions};
    return this.positionFloatingElement(element,anchorX,anchorY,nextOptions);
  }
  disposeFloatingElement(element){
    if(!element)return;
    if(element.__siwordsRepositionFrame)window.cancelAnimationFrame?.(element.__siwordsRepositionFrame);
    element.__siwordsRepositionFrame=0;element.__siwordsResizeObserver?.disconnect();element.remove();
  }
  showPopover(word,x,y){
    const existing=this.activePopoverElement?.isConnected?this.activePopoverElement:null;
    if(existing&&this.activePopoverWordId===word.id){
      if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;
      return existing;
    }
    if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;
    this.hidePopover();
    const pop=document.createElement("div");pop.className="siwords-popover siwords-ui";
    if(this.warmingFloatingSurface){pop.style.opacity="0";pop.style.pointerEvents="none";pop.setAttribute("aria-hidden","true");}
    pop.dataset.wordId=word.id;this.activePopoverWordId=word.id;
    pop.innerHTML=`<div class="siwords-popover__head"><span class="siwords-dot" style="background:${COLORS[this.entryColor(word)]}"></span><strong>${escapeHTML(word.word)}</strong><button data-action="speak" title="发音">🔊</button></div>${this.definitionHTML(word)}${word.sentence?`<div class="siwords-context">${escapeHTML(word.sentence)}</div>`:""}${word.sourceTitle?`<button type="button" class="siwords-source" data-action="source">来源：${escapeHTML(word.sourceTitle)}</button>`:""}<div class="siwords-popover__actions"><button data-action="master">${word.mastered?"取消掌握":"标记掌握"}</button><button data-action="edit">编辑</button></div>`;
    pop.addEventListener("mouseenter",()=>{if(this.hideTimer)window.clearTimeout(this.hideTimer);this.hideTimer=null;});
    pop.addEventListener("mouseleave",()=>this.hidePopoverSoon());
    this.bindSectionTabs(pop);
    pop.querySelector('[data-action="speak"]').addEventListener("click",()=>this.speak(word.word));
    pop.querySelector('[data-action="master"]').addEventListener("click",async()=>{await this.toggleMastered(word.id);this.hidePopover();});
    pop.querySelector('[data-action="edit"]').addEventListener("click",()=>{this.hidePopover();this.openWordDialog(word);});
    pop.querySelector('[data-action="source"]')?.addEventListener("click",()=>this.openWordSource(word));
    document.body.appendChild(pop);this.activePopoverElement=pop;
    const options={alignStart:true,gap:8};
    const placed=this.provisionalFloatingElement(pop,x,y,{...options,estimatedWidth:360,estimatedHeight:440});
    this.observeFloatingElement(pop,x,y,{...options,placement:placed?.placement});
    return pop;
  }
  async toggleMastered(id){
    const word=this.state.words.find((item)=>item.id===id);if(!word)return;
    word.mastered=!word.mastered;word.masteredAt=word.mastered?nowISO():"";word.updatedAt=nowISO();
    await this.commitChange(word.mastered?`已掌握：${word.word}`:`重新学习：${word.word}`);
  }
  currentDocumentWordIds(){
    const root=this.activeSurfaceRoot();
    if(!root||!this.surfaceAllowed(root))return new Set();
    const record=this.getSurfaceRecord(root);
    return new Set((record?.matches||[]).map((match)=>match.entry.id));
  }
  currentDockSignature(ids){return [...ids].sort().join("|");}
  refreshDockForSurface(){
    if(!this.dock?.element||!this.isRenderSurfaceVisible(this.dock.element)||this.dockTab!=="current")return;
    const current=this.currentDocumentWordIds();
    const signature=this.currentDockSignature(current);
    if(signature===this.dockCurrentSignature)return;
    this.renderDock(current);
  }
  wordCardHTML(word){
    return `<article class="siwords-card ${word.mastered?"is-mastered":""}" data-word-id="${escapeHTML(word.id)}" style="--siwords-color:${COLORS[this.entryColor(word)]}"><div class="siwords-card__title"><strong>${escapeHTML(word.word)}</strong><span class="fn__flex-1"></span><button data-action="speak" title="发音">🔊</button><button data-action="master" title="切换掌握状态">${word.mastered?"↩":"✓"}</button></div>${this.definitionHTML(word)}${word.sentence?`<div class="siwords-context">${escapeHTML(word.sentence)}</div>`:""}<div class="siwords-card__meta"><span>${escapeHTML(bookFor(this.state,word)?.name||"")}</span><button data-action="edit">编辑</button></div></article>`;
  }
  renderDock(currentOverride=undefined, force=false){
    const dockElement=this.dock?.element;
    if(!dockElement)return;
    if(!force&&!this.isRenderSurfaceVisible(dockElement)){this.dockNeedsRender=true;return;}
    this.dockNeedsRender=false;
    const current=this.dockTab==="current"?(currentOverride instanceof Set?currentOverride:this.currentDocumentWordIds()):null;
    if(current)this.dockCurrentSignature=this.currentDockSignature(current);else this.dockCurrentSignature=null;
    const enabledBooks=new Set(this.state.books.filter((book)=>book.enabled!==false).map((book)=>book.id));
    let words=this.state.words.filter((word)=>enabledBooks.has(word.bookId)&&(this.dockTab==="current"?current.has(word.id):this.dockTab==="mastered"?word.mastered:!word.mastered));
    const query=canonicalKey(this.dockSearch);if(query)words=words.filter((word)=>canonicalKey(`${word.word} ${word.rawDefinition||word.definition}`).includes(query));words.sort((a,b)=>a.word.localeCompare(b.word));
    const limit=(this.dockPage+1)*DOCK_PAGE_SIZE;const visible=words.slice(0,limit);
    const root=this.dock.element;
    root.innerHTML=`<div class="siwords-dock siwords-ui fn__flex-column"><div class="block__icons"><div class="block__logo"><svg class="block__logoicon"><use xlink:href="#iconSiWords"></use></svg>SiWords</div><span class="fn__flex-1"></span><button class="block__icon" data-action="manage" aria-label="管理词库"><svg><use xlink:href="#iconSettings"></use></svg></button></div><div class="siwords-dock__tabs"><button class="${this.dockTab==="current"?"is-active":""}" data-tab="current">当前文档</button><button class="${this.dockTab==="learning"?"is-active":""}" data-tab="learning">学习中</button><button class="${this.dockTab==="mastered"?"is-active":""}" data-tab="mastered">已掌握</button></div><div class="siwords-dock__search"><input class="b3-text-field" data-role="search" placeholder="搜索生词" value="${escapeHTML(this.dockSearch)}"><span>${words.length}</span></div><div class="siwords-dock__list fn__flex-1">${visible.length?visible.map((word)=>this.wordCardHTML(word)).join(""):`<div class="siwords-empty">${this.dockTab==="current"?"当前文档还没有命中生词":"这里还没有单词"}</div>`}${visible.length<words.length?`<button class="b3-button b3-button--outline siwords-dock-more" data-action="dock-more">再显示 ${Math.min(DOCK_PAGE_SIZE,words.length-visible.length)} 条</button>`:""}</div></div>`;
    root.querySelector('[data-action="manage"]').addEventListener("click",()=>this.openManager());
    root.querySelectorAll("[data-tab]").forEach((button)=>button.addEventListener("click",()=>{this.dockTab=button.dataset.tab;this.dockPage=0;this.dockCurrentSignature=null;this.renderDock();}));
    root.querySelector('[data-role="search"]').addEventListener("change",(event)=>{this.dockSearch=event.target.value;this.dockPage=0;this.renderDock();});
    root.querySelector('[data-action="dock-more"]')?.addEventListener("click",()=>{this.dockPage+=1;this.renderDock();});
    root.querySelectorAll("[data-word-id]").forEach((row)=>{const word=this.state.words.find((item)=>item.id===row.dataset.wordId);if(!word)return;row.querySelector('[data-action="speak"]')?.addEventListener("click",()=>this.speak(word.word));row.querySelector('[data-action="master"]')?.addEventListener("click",()=>this.toggleMastered(word.id));row.querySelector('[data-action="edit"]')?.addEventListener("click",()=>this.openWordDialog(word));});
    this.bindSectionTabs(root);
  }
  hideTranslationPopover(){
    this.translationGeneration=(this.translationGeneration||0)+1;
    this.translationController?.abort();this.translationController=null;
    if(typeof document!=="undefined")document.querySelectorAll(".siwords-translate-popover").forEach((item)=>this.disposeFloatingElement(item));
  }
  onKeyDown(event){if(event.key==="Escape"){this.cancelHoverInspection();this.cancelSelectionIntent();this.hidePopover();this.hideTranslationPopover();this.removeFloat();}}
  async copyText(text){
    const value=String(text||"");
    if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);
    const area=document.createElement("textarea");area.value=value;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();
  }
  translationCacheKey(config,prompt,target,text){
    return JSON.stringify({provider:config.provider,apiUrl:config.apiUrl,model:config.model,prompt,target,text,extraParams:config.extraParams||"{}"});
  }
  showTranslationPopover(context,rect){
    const text=String(context?.text||"").trim();
    if(!text||text.length>500)return null;
    this.hideTranslationPopover();
    const generation=++this.translationGeneration;
    const translationController=new AbortController();
    this.translationController=translationController;
    const pop=document.createElement("div");pop.className="siwords-translate-popover siwords-ui";
    pop.innerHTML=`<div class="siwords-translate-head"><strong>划词翻译</strong><button type="button" data-action="translate-close" aria-label="关闭">×</button></div><div class="siwords-translate-source">${escapeHTML(text)}</div><div class="siwords-translate-result" data-role="translate-result">正在翻译…</div><div class="siwords-translate-actions"><button type="button" data-action="translate-copy" disabled>复制</button><button type="button" data-action="translate-add" disabled>加入生词本</button></div>`;
    document.body.appendChild(pop);
    const translationAnchorX=Number(rect?.left??rect?.right??16);
    const translationAnchorY=Number(rect?.bottom??rect?.top??16);
    const viewportHeight=Number(this.currentViewportMetrics().height)||720;
    const translationPositionOptions={alignStart:true,gap:8,reserveHeight:Math.min(340,Math.max(120,viewportHeight-24))};
    const placed=this.provisionalFloatingElement(pop,translationAnchorX,translationAnchorY,{...translationPositionOptions,estimatedWidth:390,estimatedHeight:340});
    this.observeFloatingElement(pop,translationAnchorX,translationAnchorY,{...translationPositionOptions,placement:placed?.placement});
    const resultNode=pop.querySelector('[data-role="translate-result"]');
    const addButton=pop.querySelector('[data-action="translate-add"]');
    const copyButton=pop.querySelector('[data-action="translate-copy"]');
    let translation="";
    pop.querySelector('[data-action="translate-close"]').addEventListener("click",()=>this.hideTranslationPopover());
    copyButton.addEventListener("click",async()=>{if(!translation)return;await this.copyText(translation);copyButton.textContent="已复制";window.setTimeout(()=>{if(copyButton.isConnected)copyButton.textContent="复制";},1500);});
    addButton.addEventListener("click",()=>{
      if(!translation)return;
      const draft=normalizeWord({word:text,definition:translation,rawDefinition:translation,sentence:context.sentence||"",language:context.language||"en",bookId:this.state.settings.currentBookId,sourceDocId:context.sourceDocId||"",sourceBlockId:context.sourceBlockId||"",sourceTitle:context.sourceTitle||"",sourcePath:context.sourcePath||"",sourceBox:context.sourceBox||"",sourcePdfPage:context.sourcePdfPage||0},this.state.settings.currentBookId);
      this.hideTranslationPopover();this.openWordDialog(draft);
    });
    (async()=>{
      try{
        if(!this.state.settings.aiEnabled)throw new Error("AI 尚未启用");
        const target=String(this.state.settings.translateTargetLang||this.state.settings.selectionTranslate?.targetLang||"zh-CN");
        const template=String(this.state.settings.translatePrompt||this.state.settings.selectionTranslate?.prompt||DEFAULT_TRANSLATE_PROMPT);
        if(!template.includes("{{text}}")||(!template.includes("{{to}}")&&!template.includes("{{targetLang}}")))throw new Error("翻译提示词必须包含 {{text}} 和 {{to}}");
        const prompt=applyTemplate(template,{text,to:target,targetLang:target});
        const config=await this.currentAIConfig();
        if(translationController.signal.aborted||generation!==this.translationGeneration)return;
        const key=this.translationCacheKey(config,prompt,target,text);
        const cached=this.aiCache.get(key);
        const ttl=Math.max(0,Number(this.state.settings.aiCacheMinutes)||30)*60*1000;
        if(cached&&Date.now()-cached.at<ttl){translation=cached.value;this.aiCache.delete(key);this.aiCache.set(key,cached);}
        else{
          translation=await this.requestAI(prompt,config,{signal:translationController.signal});
          if(translation){this.aiCache.set(key,{at:Date.now(),value:translation});while(this.aiCache.size>250)this.aiCache.delete(this.aiCache.keys().next().value);}
        }
        if(translationController.signal.aborted||generation!==this.translationGeneration||!pop.isConnected)return;
        resultNode.innerHTML=renderMarkdown(translation);addButton.disabled=false;copyButton.disabled=false;
      }catch(error){
        if(error?.name==="AbortError")return;
        if(generation!==this.translationGeneration||!pop.isConnected)return;
        resultNode.textContent=`翻译失败：${error.message||error}`;
      }finally{
        if(this.translationController===translationController)this.translationController=null;
      }
    })();
    return pop;
  }
  openWordSource(word){
    const id=word?.sourceBlockId||word?.sourceDocId;
    if(!id)return showMessage("这个词条没有可定位的来源");
    try{return openTab({app:this.app,doc:{id,action:["cb-get-focus","cb-get-hl"]}});}
    catch(error){showMessage(`无法打开来源：${error.message||error}`,4500,"error");return null;}
  }
  async getSiYuanProvider() {
    const cached=this.siyuanAIConfigCache;
    if(cached&&Date.now()-cached.at<60000)return {...cached.value,temperature:Number(this.state.settings.aiTemperature)||0.2,maxTokens:Number(this.state.settings.aiMaxTokens)||600};
    const response = await fetch("/api/system/getConf", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((item) => item.json());
    if (response.code !== 0) throw new Error(response.msg || "无法读取思源 AI 配置");
    const ai = response.data?.conf?.ai;
    const providers = ai?.providers || [];
    const modelId = ai?.agent?.modelId;
    let provider;
    let model;
    for (const candidate of providers) {
      const hit = (candidate.models || []).find((item) => item.enabled && item.id === modelId);
      if (candidate.enabled && hit) { provider = candidate; model = hit; break; }
    }
    if (!provider) {
      provider = providers.find((item) => item.enabled && (item.models || []).some((modelItem) => modelItem.enabled));
      model = provider?.models?.find((item) => item.enabled);
    }
    if (!provider || !model) throw new Error("思源中没有启用可用的 AI 模型");
    const value={
      provider: "openai-compatible",
      apiUrl: String(provider.baseURL || "").replace(/\/+$/, ""),
      apiKey: String(provider.apiKey || ""),
      model: model.id || model.name,
      temperature: Number(this.state.settings.aiTemperature) || 0.2,
      maxTokens: Number(this.state.settings.aiMaxTokens) || 600,
      timeout: Math.max(15, Number(provider.requestTimeout) || 90),
    };
    this.siyuanAIConfigCache={at:Date.now(),value};
    return {...value};
  }
  async currentAIConfig() {
    if (this.state.settings.aiSource === "siyuan") {
      const config=await this.getSiYuanProvider();
      return {...config,extraParams:this.state.settings.aiExtraParams,retries:this.state.settings.aiRetries};
    }
    return {
      provider: normalizeAIProvider(this.state.settings.aiProvider),
      apiUrl: this.state.settings.aiApiUrl,
      apiKey: this.secrets?.apiKey || "",
      model: this.state.settings.aiModel,
      temperature: Number(this.state.settings.aiTemperature),
      maxTokens: Number(this.state.settings.aiMaxTokens),
      timeout: 90,
      extraParams: this.state.settings.aiExtraParams,
      retries: this.state.settings.aiRetries,
    };
  }
  async requestAI(prompt, overrideConfig = null, options = {}) {
    const externalSignal=options?.signal;
    if(externalSignal?.aborted)throw Object.assign(new Error("请求已取消"),{name:"AbortError"});
    const config = overrideConfig || await this.currentAIConfig();
    const request = buildAIRequest(config, prompt);
    const retries=Math.max(0,Math.min(2,Number(config.retries)||0));
    let lastError;
    for(let attempt=0;attempt<=retries;attempt+=1){
      if(externalSignal?.aborted)throw Object.assign(new Error("请求已取消"),{name:"AbortError"});
      const controller=new AbortController();
      const abortFromExternal=()=>controller.abort();
      externalSignal?.addEventListener?.("abort",abortFromExternal,{once:true});
      this.aiControllers ||= new Set();this.aiControllers.add(controller);this.aiController=controller;
      let timedOut=false;let retryDelay=0;
      const timer=window.setTimeout(()=>{timedOut=true;controller.abort();},Math.max(15,Number(config.timeout)||90)*1000);
      try{
        const response=await fetch(request.endpoint,{method:"POST",headers:request.headers,body:JSON.stringify(request.body),signal:controller.signal});
        let payload;try{payload=await response.json();}catch(_){payload={};}
        if(!response.ok){
          const error=new Error(payload?.error?.message||payload?.message||`模型请求失败（${response.status}）`);
          error.status=response.status;error.retryAfter=response.headers?.get?.("retry-after")||"";throw error;
        }
        return parseAIResponse(request.type,payload);
      }catch(error){
        if(externalSignal?.aborted)throw Object.assign(new Error("请求已取消"),{name:"AbortError"});
        lastError=timedOut?Object.assign(new Error("模型请求超时"),{status:408}):error;
        if(attempt>=retries||!shouldRetry(lastError)){
          if(lastError?.message)lastError.message=redactSecret(lastError.message,config.apiKey);
          throw lastError;
        }
        const retryAfter=Number(lastError.retryAfter);
        retryDelay=Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:(attempt+1)*1000;
      }finally{
        window.clearTimeout(timer);
        externalSignal?.removeEventListener?.("abort",abortFromExternal);
        this.aiControllers.delete(controller);
        if(this.aiController===controller)this.aiController=null;
      }
      if(retryDelay>0)await new Promise((resolve,reject)=>{
        const waitTimer=window.setTimeout(()=>{externalSignal?.removeEventListener?.("abort",abortWait);resolve();},retryDelay);
        const abortWait=()=>{window.clearTimeout(waitTimer);externalSignal?.removeEventListener?.("abort",abortWait);reject(Object.assign(new Error("请求已取消"),{name:"AbortError"}));};
        externalSignal?.addEventListener?.("abort",abortWait,{once:true});
        if(externalSignal?.aborted)abortWait();
      });
    }
    throw lastError||new Error("模型请求失败");
  }
  async generateDefinition(word, sentence, language = "en") {
    if (!this.state.settings.aiEnabled) throw new Error("AI 释义尚未启用");
    if (!String(this.state.settings.aiPrompt || "").includes("{{word}}")) throw new Error("释义提示词必须包含 {{word}}");
    const prompt = applyTemplate(this.state.settings.aiPrompt, { word, sentence, language });
    return this.requestAI(prompt);
  }
  async testAIConnection() {
    const status = this.managerRoot?.querySelector('[data-role="ai-settings-status"]');
    if (status) status.textContent = "正在测试 AI 连接…";
    try {
      const result = await this.requestAI('Reply with only "OK".');
      if (status) status.textContent = `连接成功：${String(result).slice(0, 80)}`;
      showMessage("SiWords AI 连接成功");
      return true;
    } catch (error) {
      if (status) status.textContent = `连接失败：${error.message || error}`;
      showMessage(`SiWords AI 连接失败：${error.message || error}`, 6000, "error");
      return false;
    }
  }
  async importAIFromSiyuan() {
    try {
      const config = await this.getSiYuanProvider();
      this.state.settings.aiSource = "custom";
      this.state.settings.aiProvider = "openai-compatible";
      this.state.settings.aiApiUrl = config.apiUrl;
      this.state.settings.aiModel = config.model;
      this.secrets.apiKey = config.apiKey;
      await this.saveSecrets();
      await this.commitChange("已从思源导入 AI 配置");
    } catch (error) {
      showMessage(`导入思源 AI 配置失败：${error.message || error}`, 6000, "error");
    }
  }  browserSpeak(word){window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(word);utterance.lang=this.state.settings.pronunciationVariant==="uk"?"en-GB":"en-US";utterance.rate=.88;window.speechSynthesis.speak(utterance);}
  speak(text){
    const word=String(text||"").trim();if(!word)return;
    if(this.state.settings.ttsMode==="url"&&this.state.settings.ttsTemplate){
      try{const url=safeTtsUrl(this.state.settings.ttsTemplate,word);new Audio(url).play().catch(()=>{showMessage("自定义音频播放失败，已回退系统语音");this.browserSpeak(word);});return;}
      catch(error){showMessage(error.message,4000,"error");}
    }
    this.browserSpeak(word);
  }
}

SiWordsPlugin.__test={canonicalKey,normalizeSearchText,normalizeAliases,defaultSettings,defaultState,normalizeState,normalizeWord,normalizeBook,validateRawState,validateState,chooseStatePayload,parsePatternPhrase,parseDefinitionSections,isDocumentInScope,buildMatcher,findTermMatches,extractSentence,applyTemplate,safeRemoteUrl,safeTtsUrl,redactSecret,deleteWordState,restoreWordState,renderMarkdown,entryColor,normalizeAIProvider,detectAIType,deepMergeSafe,mergeExtraParams,shouldRetry,buildAIRequest,parseAIResponse};
module.exports=SiWordsPlugin;