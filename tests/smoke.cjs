"use strict";

const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
const messages = [];

class MockPlugin {
  constructor() {
    this._data = {};
    this.name = "siyuan-plugin-wordflow";
    this.app = {};
    this.eventBus = { on() {}, off() {} };
  }
  async loadData(name) { return this._data[name] == null ? null : JSON.parse(JSON.stringify(this._data[name])); }
  async saveData(name, value) { if (this._failNext) { this._failNext = false; throw new Error("simulated write failure"); } this._data[name] = JSON.parse(JSON.stringify(value)); }
  async removeData(name) { delete this._data[name]; }
  addIcons() {}
  addTab(config) { this._tab = config; return config; }
  addDock(config) { this._dock = config; return config; }
  addCommand() {}
  addTopBar() {}
}
Module._load = function(request, parent, isMain) {
  if (request === "siyuan") return {
    Plugin: MockPlugin,
    Dialog: class Dialog {},
    showMessage(message) { messages.push(String(message)); },
    openTab() { return Promise.resolve({}); },
  };
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require("../index.js");
const core = PluginClass.__test;

async function main() {
  assert.equal(core.canonicalKey("  Take   Off "), "take off");
  assert.equal(core.canonicalKey("Learner’s"), "learner's");
  assert.deepEqual(core.normalizeAliases(["Test", " test ", "Alias"]), ["Test", "Alias"]);

  const entries = [
    { id: "1", word: "art", aliases: [] },
    { id: "2", word: "take off", aliases: ["took off"] },
  ];
  let matches = core.findTermMatches("The artist saw art take off, then it took off.", core.buildMatcher(entries));
  assert.deepEqual(matches.map((item) => item.term), ["art", "take off", "took off"]);
  assert.equal(core.findTermMatches("partial artistic", entries).length, 0);
  const overlap = core.findTermMatches("New York is new.", [
    { id: "short", word: "new", aliases: [] },
    { id: "long", word: "new york", aliases: [] },
  ]);
  assert.deepEqual(overlap.map((item) => item.term), ["new york", "new"]);
  assert.equal(core.extractSentence("First sentence. The target word is here! Last one.", 26), "The target word is here!");

  const migrated = core.normalizeState({
    version: 2,
    cards: [
      { word: "Test", definition: "测试", example: "This is a test." },
      { word: " test ", definition: "duplicate" },
    ],
  });
  assert.equal(migrated.version, 5);
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.books[0].id, "default");
  assert.equal(migrated.words.length, 1);
  assert.equal(migrated.words[0].sentence, "This is a test.");
  assert.equal(migrated.words[0].definition, "测试");
  assert.equal(migrated.migrationHistory.at(-1).to, 5);
  assert.equal(core.validateState(migrated).ok, true);

  const invalid = core.normalizeState({ words: [{ id: "same", word: "A" }, { id: "same", word: "B" }] });
  assert.equal(core.validateState(invalid).ok, false);
  const chosen = core.chooseStatePayload({ revision: 3 }, { revision: 4 }, null);
  assert.equal(chosen.payload.revision, 4);
  assert.equal(chosen.recoveredPending, true);

  const recycle = core.defaultState();
  recycle.words.push(core.normalizeWord({ id: "w1", word: "context", definition: "上下文" }));
  assert.equal(core.deleteWordState(recycle, "w1"), true);
  assert.equal(recycle.words.length, 0);
  assert.equal(recycle.recycleBin.length, 1);
  assert.equal(core.restoreWordState(recycle, "w1"), true);
  assert.equal(recycle.words[0].word, "context");

  assert.equal(core.applyTemplate("{{word}}|{{sentence}}|{{language}}", { word: "context", sentence: "A context.", language: "en" }), "context|A context.|en");
  assert.equal(core.safeTtsUrl("https://example.com/say?q={{word}}", "take off").includes("take%20off"), true);
  assert.equal(core.safeTtsUrl("http://127.0.0.1:9000/say?q={{word}}", "local").startsWith("http://127.0.0.1:9000/"), true);
  assert.throws(() => core.safeTtsUrl("javascript:alert({{word}})", "x"));
  assert.throws(() => core.safeTtsUrl("http://example.com/say?q={{word}}", "x"), /HTTPS/);
  assert.equal(core.redactSecret("request failed for secret-token", "secret-token"), "request failed for [redacted]");
  assert.equal(core.renderMarkdown("**bold** <script>x</script>").includes("<strong>bold</strong>"), true);
  assert.equal(core.renderMarkdown("<script>x</script>").includes("<script>"), false);

  const openaiRequest = core.buildAIRequest({ provider: "openai-compatible", apiUrl: "https://example.com/v1", apiKey: "secret", model: "mock" }, "hello");
  assert.equal(openaiRequest.type, "openai");
  assert.equal(openaiRequest.endpoint, "https://example.com/v1/chat/completions");
  assert.equal(openaiRequest.headers.Authorization, "Bearer secret");
  const anthropicRequest = core.buildAIRequest({ provider: "anthropic", apiUrl: "https://api.anthropic.com", apiKey: "secret", model: "claude" }, "hello");
  assert.equal(anthropicRequest.endpoint, "https://api.anthropic.com/v1/messages");
  assert.equal(anthropicRequest.headers["x-api-key"], "secret");
  const geminiRequest = core.buildAIRequest({ provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "secret", model: "gemini-test" }, "hello");
  assert.ok(geminiRequest.endpoint.includes("/models/gemini-test:generateContent?key=secret"));
  assert.equal(core.parseAIResponse("anthropic", { content: [{ text: "Claude OK" }] }), "Claude OK");
  assert.equal(core.parseAIResponse("gemini", { candidates: [{ content: { parts: [{ text: "Gemini OK" }] } }] }), "Gemini OK");
  assert.throws(() => core.buildAIRequest({ provider: "custom", apiUrl: "file:///tmp/model", apiKey: "x", model: "m" }, "hello"), /HTTPS/);
  assert.throws(() => core.buildAIRequest({ provider: "custom", apiUrl: "http://example.com/v1", apiKey: "x", model: "m" }, "hello"), /HTTPS/);

  const plugin = new PluginClass();
  plugin._data["siwords-state.json"] = { version: 2, books: [{ id: "default", name: "旧词库", color: "2" }], words: [{ id: "old", word: "Legacy", definition: "旧数据" }] };
  await plugin.onload();
  assert.equal(plugin.state.schemaVersion, 5);
  assert.equal(plugin.state.words[0].word, "Legacy");
  assert.equal(plugin._data["siwords-state.json"].schemaVersion, 5);
  assert.equal(plugin._data["siwords-pending.json"], undefined);
  assert.equal(plugin._data["siwords-backups.json"].snapshots.length, 1);

  const recovered = new PluginClass();
  recovered._data["siwords-state.json"] = { ...core.defaultState(), revision: 2, words: [{ id: "a", word: "old" }] };
  recovered._data["siwords-pending.json"] = { ...core.defaultState(), revision: 3, words: [{ id: "b", word: "recovered" }] };
  await recovered.onload();
  assert.equal(recovered.state.words[0].word, "recovered");
  assert.equal(recovered._data["siwords-pending.json"], undefined);

  const retrying = new PluginClass();
  retrying.state = core.defaultState();
  retrying.writeQueue = Promise.resolve();
  retrying.isSaving = false;
  retrying._failNext = true;
  await assert.rejects(() => retrying.saveState("first"), /simulated write failure/);
  await retrying.saveState("retry");
  assert.equal(retrying._data["siwords-state.json"].schemaVersion, 5);
  const largeEntries = Array.from({ length: 5000 }, (_, index) => ({ id: String(index), word: `word${index}`, aliases: [] }));
  const buildStart = Date.now();
  const largeMatcher = core.buildMatcher(largeEntries);
  const buildMs = Date.now() - buildStart;
  const text = `${"ordinary text ".repeat(4000)} word4999 and word2500.`;
  const matchStart = Date.now();
  const largeMatches = core.findTermMatches(text, largeMatcher);
  const matchMs = Date.now() - matchStart;
  assert.deepEqual(largeMatches.map((item) => item.term), ["word4999", "word2500"]);
  assert.ok(buildMs < 2500, `5k matcher build too slow: ${buildMs}ms`);
  assert.ok(matchMs < 1500, `50k text match too slow: ${matchMs}ms`);

  process.stdout.write(JSON.stringify({ ok: true, tests: 48, buildMs, matchMs, messages: messages.length }) + "\n");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });