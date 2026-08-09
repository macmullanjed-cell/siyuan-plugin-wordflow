"use strict";

// P0 state-safety contract.  This file intentionally exercises the shipped
// index.js bundle, rather than a copied implementation in the test suite.
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
  async loadData(name) {
    return this._data[name] == null ? null : JSON.parse(JSON.stringify(this._data[name]));
  }
  async saveData(name, value) {
    this._data[name] = JSON.parse(JSON.stringify(value));
  }
  async removeData(name) { delete this._data[name]; }
  addIcons() {}
  addTab(config) { this._tab = config; return config; }
  addDock(config) { this._dock = config; return config; }
  addCommand() {}
  addTopBar() {}
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "siyuan") {
    return {
      Plugin: MockPlugin,
      Dialog: class Dialog {},
      showMessage(message) { messages.push(String(message)); },
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

function stateWithWord(word, revision = 1) {
  const state = core.defaultState();
  state.revision = revision;
  state.words = [core.normalizeWord({ id: `word-${word}`, word, definition: `definition:${word}` })];
  return state;
}

(async () => {
  await test("raw v4 corruption is rejected before normalization", async () => {
    assert.equal(typeof core.validateRawState, "function", "required __test export: validateRawState(payload)");

    // normalizeState currently repairs these fields to empty defaults.  P0 must
    // reject the source first, otherwise silent data loss looks like a valid
    // empty library.
    const corrupt = {
      version: 4,
      schemaVersion: 4,
      libraryId: "damaged-library",
      revision: 17,
      books: "not-an-array",
      words: { accidentally: "overwritten" },
      settings: {},
    };
    const validation = core.validateRawState(corrupt);
    assert.equal(validation.ok, false, "malformed books/words must be rejected in raw form");
    assert.ok(validation.errors.length > 0, "raw validation should explain why the payload was rejected");

    const duplicate = stateWithWord("alpha", 18);
    duplicate.words.push({ ...duplicate.words[0], word: "beta", key: "beta" });
    assert.equal(core.validateRawState(duplicate).ok, false, "duplicate raw IDs must not be normalized away");
  });

  await test("startup recovers a valid backup instead of persisting normalized corruption", async () => {
    const corrupt = {
      version: 4,
      schemaVersion: 4,
      libraryId: "damaged-library",
      revision: 20,
      books: "not-an-array",
      words: "not-an-array",
      settings: {},
    };
    const validBackup = stateWithWord("recovered-marker", 19);
    const plugin = new PluginClass();
    plugin._data["siwords-state.json"] = corrupt;
    plugin._data["siwords-backups.json"] = {
      version: 1,
      snapshots: [{
        id: "backup-1",
        savedAt: new Date().toISOString(),
        reason: "known-good",
        state: validBackup,
        rawState: validBackup,
      }],
    };

    await plugin.onload();
    assert.deepEqual(plugin.state.words.map((item) => item.word), ["recovered-marker"]);
    assert.deepEqual(plugin._data["siwords-state.json"].words.map((item) => item.word), ["recovered-marker"]);
    assert.notEqual(plugin.state.libraryId, "damaged-library", "damaged payload must not become a valid empty library");
  });

  await test("backup preserves an immutable exact raw payload", async () => {
    const plugin = new PluginClass();
    const raw = {
      version: 2,
      cards: [{ word: "  Mixed  Case  ", definition: "", unknownCardField: { keep: true } }],
      unknownTopLevel: { nested: [1, 2, 3] },
    };
    const expected = JSON.parse(JSON.stringify(raw));
    const snapshot = await plugin.createBackup("pre-migration", raw);

    assert.ok(Object.prototype.hasOwnProperty.call(snapshot, "rawState"), "backup snapshot must expose rawState");
    assert.deepStrictEqual(snapshot.rawState, expected, "rawState must be byte-structure equivalent JSON, without normalization");
    raw.cards[0].word = "mutated-after-save";
    raw.unknownTopLevel.nested.push(4);
    assert.deepStrictEqual(snapshot.rawState, expected, "backup must not retain references to the caller payload");
    assert.deepStrictEqual(plugin._data["siwords-backups.json"].snapshots[0].rawState, expected);
  });

  await test("search normalization preserves original offsets", async () => {
    assert.equal(typeof core.normalizeSearchText, "function", "required __test export: normalizeSearchText(value)");
    const original = "\u200b  Learner\u2019s\u00a0\u00a0co\u00adoperate  ";
    const normalized = core.normalizeSearchText(original);
    assert.ok(normalized && typeof normalized.text === "string", "normalizeSearchText must return {text,startMap,endMap}");
    assert.ok(Array.isArray(normalized.startMap), "normalizeSearchText.startMap must be an array");
    assert.ok(Array.isArray(normalized.endMap), "normalizeSearchText.endMap must be an array");
    assert.equal(normalized.startMap.length, normalized.text.length);
    assert.equal(normalized.endMap.length, normalized.text.length);
    assert.ok(normalized.text.includes("learner's cooperate"), `unexpected normalized text: ${JSON.stringify(normalized.text)}`);
    assert.equal(/[\u00ad\u200b]/u.test(normalized.text), false, "soft hyphen and zero-width space must not affect matching");

    const needle = "learner's cooperate";
    const normalizedStart = normalized.text.indexOf(needle);
    const originalStart = normalized.startMap[normalizedStart];
    const originalEnd = normalized.endMap[normalizedStart + needle.length - 1];
    assert.equal(original.slice(originalStart, originalEnd), "Learner\u2019s\u00a0\u00a0co\u00adoperate");

    assert.equal(core.canonicalKey(original), needle);
    const source = "Start \u200bLearner\u2019s\u00a0 \u00adcooperate end.";
    const matches = core.findTermMatches(source, [{ id: "normalized", word: needle, aliases: [] }]);
    assert.equal(matches.length, 1, "normalized punctuation/spacing/invisible characters must still match");
    assert.equal(source.slice(matches[0].start, matches[0].end), "Learner\u2019s\u00a0 \u00adcooperate");
  });

  await test("queued saves preserve mutations made while an earlier write is pending", async () => {
    const plugin = new PluginClass();
    await plugin.onload();
    let delayed = false;
    plugin.saveData = async function saveDataWithDelay(name, value) {
      if (name === "siwords-pending.json" && !delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      this._data[name] = JSON.parse(JSON.stringify(value));
    };

    plugin.state.settings.aiApiUrl = "https://first.invalid/v1";
    const first = plugin.saveState("first concurrent write");
    await new Promise((resolve) => setTimeout(resolve, 5));
    plugin.state.settings.aiApiUrl = "http://127.0.0.1:54321/v1";
    plugin.state.settings.aiModel = "latest-model";
    const second = plugin.saveState("second concurrent write");
    await Promise.all([first, second]);

    assert.equal(plugin.state.settings.aiApiUrl, "http://127.0.0.1:54321/v1");
    assert.equal(plugin.state.settings.aiModel, "latest-model");
    assert.equal(plugin._data["siwords-state.json"].settings.aiApiUrl, "http://127.0.0.1:54321/v1");
    assert.equal(plugin._data["siwords-state.json"].settings.aiModel, "latest-model");
  });

  await test("pending snapshot unlocks visible feedback before the main write", async () => {
    const plugin = new PluginClass();
    plugin.state = stateWithWord("feedback", 7);
    plugin.writeQueue = Promise.resolve();
    plugin.storageQuarantined = false;
    plugin.isSaving = false;
    const events = [];
    plugin.saveData = async (name) => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, name.includes("pending") ? 20 : 30));
      events.push(`${name}:end`);
    };
    plugin.removeData = async (name) => { events.push(`${name}:remove`); };
    await plugin.saveState("callback ordering", { onPendingSaved: () => events.push("feedback") });
    const pendingEnd = events.indexOf("siwords-pending.json:end");
    const feedback = events.indexOf("feedback");
    const stateStart = events.indexOf("siwords-state.json:start");
    assert.ok(pendingEnd >= 0 && pendingEnd < feedback, "feedback must wait for the recovery snapshot");
    assert.ok(feedback < stateStart, "feedback must not wait for the second full-state write");
    assert.ok(events.includes("siwords-pending.json:remove"), "pending snapshot must be removed after the main write");
  });

  process.stdout.write(JSON.stringify({ suite: "p0-state-regression", passed, failed: failures.length, messages: messages.length }) + "\n");
  if (failures.length) process.exitCode = 1;
})().finally(() => {
  Module._load = originalLoad;
});
