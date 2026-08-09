"use strict";

// P1/P2 pure-core contract. This suite runs against the distributed index.js.
const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
class MockPlugin {
  constructor() {
    this._data = {};
    this.name = "siyuan-plugin-wordflow";
    this.app = {};
    this.eventBus = { on() {}, off() {} };
  }
  async loadData(name) { return this._data[name] == null ? null : JSON.parse(JSON.stringify(this._data[name])); }
  async saveData(name, value) { this._data[name] = JSON.parse(JSON.stringify(value)); }
  async removeData(name) { delete this._data[name]; }
  addIcons() {}
  addTab(config) { return config; }
  addDock(config) { return config; }
  addCommand() {}
  addTopBar() {}
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "siyuan") {
    return {
      Plugin: MockPlugin,
      Dialog: class Dialog {},
      showMessage() {},
      openTab() { return Promise.resolve({}); },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require("../index.js");
const core = PluginClass.__test;
const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stderr.write(`FAIL ${name}: ${error.stack || error}\n`);
  }
}

function requireCore(name) {
  assert.equal(typeof core[name], "function", `required __test export: ${name}`);
  return core[name];
}

(async () => {
  await test("pattern parser supports multiple placeholders and Unicode ellipses", () => {
    const parsePatternPhrase = requireCore("parsePatternPhrase");
    const cases = [
      ["take ... off", ["take", "off"]],
      ["from ... to ... in", ["from", "to", "in"]],
      ["take … off", ["take", "off"]],
      ["从……到", ["从", "到"]],
    ];
    for (const [source, expectedParts] of cases) {
      const parsed = parsePatternPhrase(source);
      assert.equal(parsed?.isPattern, true, `${JSON.stringify(source)} should be recognized as a pattern`);
      assert.deepStrictEqual(parsed?.parts, expectedParts, `${JSON.stringify(source)} parsed incorrectly`);
      assert.equal(parsed?.original, source);
    }
    assert.equal(parsePatternPhrase("take off").isPattern, false, "ordinary phrases must stay exact phrases");
  });

  await test("pattern matching preserves segment offsets and respects boundaries", () => {
    const text = "We TAKE your warm coat off before leaving.";
    const matches = core.findTermMatches(text, [{ id: "take-pattern", word: "take ... off", aliases: [] }]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].entry.id, "take-pattern");
    assert.equal(text.slice(matches[0].start, matches[0].end), "TAKE your warm coat off");
    assert.deepStrictEqual(
      matches[0].segments.map((segment) => text.slice(segment.start, segment.end).toLocaleLowerCase()),
      ["take", "off"],
      "match.segments must point back to the literal pattern parts in the original text",
    );

    assert.equal(
      core.findTermMatches("mistake your coat offside", [{ id: "p", word: "take ... off", aliases: [] }]).length,
      0,
      "Latin word boundaries apply to every outer pattern edge",
    );
    assert.equal(
      core.findTermMatches("take your coat, then walk off", [{ id: "p", word: "take ... off", aliases: [] }]).length,
      0,
      "a wildcard must not cross punctuation",
    );
    assert.equal(
      core.findTermMatches("take your coat\noff", [{ id: "p", word: "take ... off", aliases: [] }]).length,
      0,
      "a wildcard must not cross block/sentence newlines",
    );
    assert.equal(
      core.findTermMatches("take off", [{ id: "p", word: "take ... off", aliases: [] }]).length,
      1,
      "HiWords patterns allow adjacent literal parts separated only by whitespace",
    );
  });

  await test("patterns support more than one placeholder and Unicode syntax", () => {
    const text = "Travel from London to Paris in two hours, then take your hat off.";
    const matches = core.findTermMatches(text, [
      { id: "multi", word: "from ... to ... in", aliases: [] },
      { id: "unicode", word: "take … off", aliases: [] },
    ]);
    assert.deepStrictEqual(matches.map((match) => match.entry.id), ["multi", "unicode"]);
    assert.deepStrictEqual(matches[0].segments.map((segment) => text.slice(segment.start, segment.end)), ["from", "to", "in"]);
    assert.deepStrictEqual(matches[1].segments.map((segment) => text.slice(segment.start, segment.end)), ["take", "off"]);
  });

  await test("definition sections parse CRLF, whitespace delimiters, and bold titles", () => {
    const parseDefinitionSections = requireCore("parseDefinitionSections");
    const raw = "**Meaning**\r\nLine one\r\nLine two\r\n   ---   \r\n**Examples**\r\n- First\r\n- Second";
    const sections = parseDefinitionSections(raw);
    assert.equal(sections.length, 2);
    assert.deepStrictEqual(sections.map((section) => section.title), ["Meaning", "Examples"]);
    assert.ok(sections[0].content.includes("Line one"));
    assert.ok(sections[0].content.includes("Line two"));
    assert.equal(sections[0].content.includes("**Meaning**"), false, "the title line is metadata, not duplicated body text");
    assert.ok(sections[1].content.includes("- First"));

    const inline = parseDefinitionSections("**Meaning**\nalpha --- beta");
    assert.equal(inline.length, 1, "only a delimiter-only line may split sections");
    assert.ok(inline[0].content.includes("alpha --- beta"));

    const withEmpty = parseDefinitionSections("**One**\nA\n---\n   \n---\n**Two**\nB");
    assert.deepStrictEqual(withEmpty.map((section) => section.title), ["One", "Two"], "empty delimiter groups are ignored");
  });

  await test("raw sectioned definitions survive normalization when tabs are disabled", () => {
    requireCore("parseDefinitionSections");
    const raw = "**Meaning**\r\nA precise meaning.\r\n --- \r\n**Examples**\r\n- A raw example.";
    const state = core.normalizeState({
      version: 4,
      schemaVersion: 4,
      books: [{ id: "default", name: "Default", color: "2", enabled: true }],
      settings: { enableSectionTabs: false },
      words: [{ id: "sectioned", word: "sectioned", definition: raw }],
    });
    assert.equal(state.settings.enableSectionTabs, false);
    assert.equal(state.words[0].rawDefinition, raw, "turning tabs off must not destructively flatten the source Markdown");
    assert.equal(state.words[0].definition, raw);
    assert.deepStrictEqual(state.words[0].sections.map((section) => section.title), ["Meaning", "Examples"]);
  });

  await test("Markdown renderer supports common structure without enabling script injection", () => {
    const html = core.renderMarkdown([
      "# Heading",
      "",
      "- first",
      "- second",
      "",
      "[Safe link](https://example.com/docs?q=1)",
      "",
      "`<script>alert(1)</script>`",
      "",
      "[Bad link](javascript:alert(1))",
      "<img src=x onerror=alert(1)>",
    ].join("\n"));
    assert.match(html, /<h1(?:\s[^>]*)?>Heading<\/h1>/i);
    assert.match(html, /<ul(?:\s[^>]*)?>[\s\S]*<li(?:\s[^>]*)?>first<\/li>[\s\S]*<li(?:\s[^>]*)?>second<\/li>[\s\S]*<\/ul>/i);
    assert.match(html, /<a\s[^>]*href=["']https:\/\/example\.com\/docs\?q=1["'][^>]*>Safe link<\/a>/i);
    assert.match(html, /<code(?:\s[^>]*)?>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code>/i);
    assert.equal(/<script\b/i.test(html), false);
    assert.equal(/\sonerror\s*=/i.test(html), false);
    assert.equal(/href=["']?javascript:/i.test(html), false);
  });

  await test("disabled books are excluded from the active matcher", () => {
    const plugin = new PluginClass();
    plugin.state = core.normalizeState({
      version: 4,
      schemaVersion: 4,
      books: [
        { id: "default", name: "Enabled", color: "2", enabled: true },
        { id: "disabled-book", name: "Disabled", color: "3", enabled: false },
      ],
      words: [
        { id: "enabled-word", word: "enabledword", bookId: "default" },
        { id: "disabled-word", word: "disabledword", bookId: "disabled-book" },
      ],
    });
    assert.equal(plugin.state.books.find((book) => book.id === "default").enabled, true);
    assert.equal(plugin.state.books.find((book) => book.id === "disabled-book").enabled, false);
    assert.deepStrictEqual(plugin.activeWords().map((word) => word.id), ["enabled-word"]);
  });

  await test("document scope handles all/include/exclude, descendants, boxes, and empty rules", () => {
    const isDocumentInScope = requireCore("isDocumentInScope");
    const info = { docId: "doc-child", path: "/root/A/child", box: "box-1" };
    assert.equal(isDocumentInScope(info, { scopeMode: "all", scopeRules: [] }), true);
    assert.equal(isDocumentInScope(info, { scopeMode: "include", scopeRules: [] }), false, "empty include means include nothing");
    assert.equal(isDocumentInScope(info, { scopeMode: "exclude", scopeRules: [] }), true, "empty exclude means exclude nothing");

    assert.equal(isDocumentInScope(info, {
      scopeMode: "include",
      scopeRules: [{ id: "doc-child", path: "", box: "box-1", descendants: false }],
    }), true, "exact document ID matches");
    assert.equal(isDocumentInScope(info, {
      scopeMode: "include",
      scopeRules: [{ id: "", path: "/root/A", box: "box-1", descendants: false }],
    }), false, "an exact path rule does not include children unless requested");
    assert.equal(isDocumentInScope(info, {
      scopeMode: "include",
      scopeRules: [{ id: "", path: "/root/A", box: "box-1", descendants: true }],
    }), true, "descendant path rules include their slash-delimited subtree");
    assert.equal(isDocumentInScope({ docId: "other", path: "/root/AB/child", box: "box-1" }, {
      scopeMode: "include",
      scopeRules: [{ id: "", path: "/root/A", box: "box-1", descendants: true }],
    }), false, "/root/A must not accidentally match /root/AB");
    assert.equal(isDocumentInScope(info, {
      scopeMode: "include",
      scopeRules: [{ id: "", path: "/root/A", box: "box-2", descendants: true }],
    }), false, "a rule with a box constraint must not cross notebooks");

    assert.equal(isDocumentInScope(info, {
      scopeMode: "exclude",
      scopeRules: [{ id: "", path: "/root/A", box: "box-1", descendants: true }],
    }), false, "a matching exclusion rejects the document");
    assert.equal(isDocumentInScope({ docId: "elsewhere", path: "/root/B", box: "box-1" }, {
      scopeMode: "exclude",
      scopeRules: [{ id: "", path: "/root/A", box: "box-1", descendants: true }],
    }), true);

    assert.equal(isDocumentInScope({ docId: "legacy-id", path: "", box: "" }, {
      scopeMode: "include",
      scopeDocIds: "legacy-id, another-id",
    }), true, "legacy scopeDocIds remain readable after the schema upgrade");
  });

  await test("AI extra parameters deep-merge without mutating base and reject invalid JSON", () => {
    const mergeExtraParams = requireCore("mergeExtraParams");
    const base = {
      model: "base-model",
      messages: [{ role: "user", content: "hello" }],
      metadata: { base: true, nested: { left: 1 } },
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
    };
    const before = JSON.parse(JSON.stringify(base));
    const merged = mergeExtraParams(base, JSON.stringify({
      metadata: { trace: "abc", nested: { right: 2 } },
      generationConfig: { topP: 0.9 },
      top_p: 0.8,
    }));
    assert.deepStrictEqual(base, before, "deep merge must not mutate the reusable base request");
    assert.deepStrictEqual(merged.metadata, { base: true, trace: "abc", nested: { left: 1, right: 2 } });
    assert.deepStrictEqual(merged.generationConfig, { temperature: 0.2, maxOutputTokens: 600, topP: 0.9 });
    assert.equal(merged.top_p, 0.8);
    assert.throws(() => mergeExtraParams(base, "{ invalid json"), /JSON|参数|Unexpected/i);

    const polluted = mergeExtraParams({}, '{"__proto__":{"siwordsPolluted":true}}');
    assert.equal({}.siwordsPolluted, undefined, "extra parameters must not enable prototype pollution");
    assert.equal(polluted.siwordsPolluted, undefined);
  });

  await test("AI retry classification separates transient, permanent, network, and abort failures", () => {
    const shouldRetry = requireCore("shouldRetry");
    for (const status of [408, 429, 500, 502, 503, 504]) {
      assert.equal(shouldRetry(status), true, `${status} should be retryable`);
      assert.equal(shouldRetry({ status }), true, `{status:${status}} should be retryable`);
    }
    for (const status of [400, 401, 403, 404]) {
      assert.equal(shouldRetry(status), false, `${status} should fail without an automatic retry`);
    }
    assert.equal(shouldRetry(new TypeError("fetch failed")), true, "network transport failures are transient");
    assert.equal(shouldRetry({ name: "AbortError" }), false, "user/unload cancellation is not a retryable failure");
  });

  await test("floating cards prefer below without sacrificing viewport safety", () => {
    const chooseFloatingPlacement = requireCore("chooseFloatingPlacement");
    assert.equal(chooseFloatingPlacement({ belowSpace: 280, aboveSpace: 420, desiredHeight: 390, minVisibleHeight: 220, preferBelow: true }), "below", "usable space below should win even when the full card needs internal scrolling");
    assert.equal(chooseFloatingPlacement({ belowSpace: 180, aboveSpace: 420, desiredHeight: 390, minVisibleHeight: 220, preferBelow: true }), "above", "a cramped lower edge must flip above instead of overflowing");
    assert.equal(chooseFloatingPlacement({ belowSpace: 420, aboveSpace: 180, desiredHeight: 390 }), "below", "the default strategy still uses a fully fitting lower surface");
    assert.equal(chooseFloatingPlacement({ belowSpace: 420, aboveSpace: 180, desiredHeight: 390, placement: "above", preferBelow: true }), "above", "an initial placement remains locked to prevent resize jitter");
  });

  await test("long definitions keep a bounded narrow-panel layout", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
    assert.match(css, /resilient long-content and narrow-panel layout/);
    assert.match(css, /\.siwords-library-word__definition[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(css, /\.siwords-section-panel[\s\S]*?word-break:\s*break-word/);
    assert.match(css, /:where\(pre, table\)[\s\S]*?overflow-x:\s*auto/);
    assert.match(css, /@container siwords-page \(max-width: 520px\)[\s\S]*?\.siwords-setting-grid[\s\S]*?grid-template-columns:\s*1fr/);
  });

  process.stdout.write(JSON.stringify({ suite: "p1-core-regression", passed, failed: failures.length }) + "\n");
  if (failures.length) process.exitCode = 1;
})().finally(() => {
  Module._load = originalLoad;
});
