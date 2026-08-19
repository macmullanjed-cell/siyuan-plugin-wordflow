"use strict";

const assert = require("assert");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  page.setDefaultTimeout(8000);
  try {
    await page.setContent(`<style>
      :root {
        --b3-theme-background:#f7f5ff; --b3-theme-surface:#fff;
        --b3-theme-on-background:#332b4f; --b3-theme-on-surface:#756d8d;
        --b3-border-color:#d9d2ef; --b3-theme-primary:#805ad5;
        --b3-list-hover:#eee9ff; --b3-card-error-color:#d14343;
      }
      html,body{margin:0;width:100%;height:100%;overflow:hidden}
      .b3-dialog{position:fixed;inset:0;display:grid;place-items:center;background:#0002}
      .b3-dialog__container{overflow:hidden;background:var(--b3-theme-surface)}
      .b3-text-field,.b3-select{font:14px sans-serif;padding:7px;border:1px solid var(--b3-border-color)}
    </style><main class="protyle-wysiwyg" data-doc-id="doc-1"><p data-node-id="block-1">We aim to improve the product carefully.</p></main>`);
    await page.addStyleTag({ path: path.resolve(__dirname, "../index.css") });
    await page.evaluate(() => {
      window.__commands = {};
      window.__messages = [];
      window.CSS.highlights = new Map();
      window.Highlight = class Highlight {};
      window.confirm = () => true;
      class MockPlugin {
        constructor() {
          this._data = {};
          this.name = "siyuan-plugin-wordflow";
          this.app = {};
          this.eventBus = { on() {}, off() {} };
        }
        async loadData(name) { return this._data[name] ?? null; }
        async saveData(name, value) { this._data[name] = JSON.parse(JSON.stringify(value)); }
        async removeData(name) { delete this._data[name]; }
        addIcons() {}
        addTab(config) { return config; }
        addDock(config) { return config; }
        addTopBar() {}
        addCommand(config) { window.__commands[config.langKey] = config; return config; }
      }
      class MockDialog {
        constructor(options) {
          this.element = document.createElement("div");
          this.element.className = "b3-dialog";
          const container = document.createElement("div");
          container.className = "b3-dialog__container";
          container.style.width = options.width || "auto";
          container.innerHTML = options.content;
          this.element.appendChild(container);
          document.body.appendChild(this.element);
        }
        destroy() { this.element.remove(); }
      }
      window.require = (name) => {
        if (name !== "siyuan") throw new Error(`Unexpected require: ${name}`);
        return {
          Plugin: MockPlugin,
          Dialog: MockDialog,
          showMessage(message) { window.__messages.push(String(message)); },
          openTab() { return Promise.resolve({}); },
        };
      };
      window.module = { exports: {} };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, "../index.js") });
    await page.evaluate(async () => {
      window.PluginClass = window.module.exports;
      window.plugin = new window.PluginClass();
      await window.plugin.onload();
      const node = document.querySelector('[data-node-id="block-1"]').firstChild;
      const start = node.textContent.indexOf("aim");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 3);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.__commands.openAddWordFromSelection.callback();
    });

    const commandInfo = await page.evaluate(() => ({
      add: window.__commands.openAddWordFromSelection?.hotkey,
      enrich: window.__commands.expandCurrentWordRelations?.hotkey,
      oldAddRegistered: Boolean(window.__commands.addSelectedWord),
      oldEnrichRegistered: Boolean(window.__commands.enrichWordRelations),
    }));
    assert.deepStrictEqual(commandInfo, {
      add: "⌥⇧⌘A",
      enrich: "⌥⇧⌘E",
      oldAddRegistered: false,
      oldEnrichRegistered: false,
    });
    assert.equal(await page.locator(".siwords-quick-add").count(), 1, "selection command must open the add-word dialog");
    assert.equal(await page.locator('[data-field="word"]').inputValue(), "aim");
    assert.equal(await page.locator('[data-field="sentence"]').inputValue(), "We aim to improve the product carefully.");
    assert.equal(await page.locator('[data-action="quick-vocabulary-expansion"]').count(), 1);

    const bounds = await page.locator(".siwords-word-dialog-host").boundingBox();
    assert.ok(bounds.width <= 390 && bounds.height <= 700, `dialog must fit the viewport: ${JSON.stringify(bounds)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "dialog must not overflow horizontally");
    assert.equal(await page.evaluate(() => {
      const root = document.querySelector(".siwords-quick-add");
      return root.scrollWidth <= root.clientWidth;
    }), true, "two AI buttons must wrap without widening the dialog");

    await page.evaluate(() => {
      window.plugin.generateVocabularyExpansion = () => new Promise((resolve) => { window.__resolveRelations = resolve; });
    });
    await page.locator('[data-action="quick-vocabulary-expansion"]').click();
    await page.locator('[data-field="word"]').fill("changed");
    await page.evaluate(() => window.__resolveRelations({
      wordFamily: [{ word: "aimless", meaning: "无目标的" }],
      synonyms: [],
      confusables: [],
    }));
    await page.waitForFunction(() => document.querySelector('[data-role="quick-status"]')?.textContent.includes("旧结果已丢弃"));
    assert.equal(await page.locator('[data-field="definition"]').inputValue(), "", "a stale response must not edit the definition");

    await page.locator('[data-field="word"]').fill("aim");
    await page.locator('[data-field="definition"]').fill("手工释义：力求做到某事。");
    await page.evaluate(() => {
      window.plugin.generateVocabularyExpansion = async () => ({
        wordFamily: [{ word: "aimless", pos: "adj.", meaning: "无目标的", note: "aim + -less" }],
        synonyms: [{ word: "intend", pos: "v.", meaning: "打算", note: "强调明确意图" }],
        confusables: [{ word: "arm", pos: "n./v.", meaning: "手臂；武装", note: "拼写相近" }],
      });
    });
    await page.locator('[data-action="quick-vocabulary-expansion"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="quick-status"]')?.textContent.includes("词汇扩展已更新"));
    let definition = await page.locator('[data-field="definition"]').inputValue();
    assert.equal(definition.startsWith("手工释义：力求做到某事。"), true);
    assert.match(definition, /\*\*词汇扩展（AI）\*\*/);
    assert.match(definition, /### 同根词/);
    assert.match(definition, /### 近义词/);
    assert.match(definition, /### 形近 \/ 易混词/);
    assert.match(definition, /#### aimless/);
    assert.match(definition, /\*\*释义\*\*：无目标的；\*\*构词\*\*：aim \+ -less/);
    assert.equal((definition.match(/^\d+\. /gm) || []).length, 0);
    assert.equal(await page.evaluate(() => window.plugin.state.words.length), 0, "AI expansion must not auto-save the draft");

    const renderedRelations = await page.evaluate((value) => {
      document.getElementById("relation-format-preview")?.remove();
      const host = document.createElement("div");
      host.id = "relation-format-preview";
      host.style.cssText = "width:320px;max-width:100%;position:fixed;inset:0 auto auto 0;z-index:99999;padding:10px;box-sizing:border-box;background:var(--b3-theme-background)";
      host.innerHTML = window.plugin.definitionHTML({
        id: "relation-format-preview",
        word: "aim",
        definition: value,
        rawDefinition: value,
        sections: [],
        updatedAt: "format-v2",
      });
      document.body.appendChild(host);
      window.plugin.bindSectionTabs(host);
      const tabs = Array.from(host.querySelectorAll(".siwords-section-tab"));
      const before = Array.from(host.querySelectorAll("[data-section-panel]")).map((item) => item.hidden);
      tabs[1]?.click();
      const panel = host.querySelector(".siwords-definition--vocabulary");
      return {
        exists: Boolean(panel),
        tabs: tabs.map((item) => item.textContent.trim()),
        before,
        after: Array.from(host.querySelectorAll("[data-section-panel]")).map((item) => item.hidden),
        categories: panel?.querySelectorAll(":scope > h3").length || 0,
        entries: panel?.querySelectorAll(":scope > h4").length || 0,
        orderedLists: panel?.querySelectorAll("ol").length || 0,
        fits: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      };
    }, definition);
    assert.deepStrictEqual(renderedRelations, {
      exists: true,
      tabs: ["释义", "✦ 词汇扩展"],
      before: [false, true],
      after: [true, false],
      categories: 3,
      entries: 3,
      orderedLists: 0,
      fits: true,
    });
    if (process.env.SIWORDS_CAPTURE_VOCAB_FORMAT === "1") {
      await page.locator("#relation-format-preview").screenshot({
        path: path.resolve(__dirname, "../artifacts/vocabulary-format-0.6.7.png"),
      });
    }

    const expansionOnlyTabs = await page.evaluate(() => {
      const value = "**词汇扩展（AI）**\n### 同根词\n\n#### finder · *noun*\n**释义**：发现者\n\n---";
      const host = document.createElement("div");
      host.innerHTML = window.plugin.definitionHTML({
        id: "expansion-only",
        word: "findings",
        definition: value,
        rawDefinition: value,
        updatedAt: "expansion-only",
      });
      document.body.appendChild(host);
      window.plugin.bindSectionTabs(host);
      const tabs = Array.from(host.querySelectorAll(".siwords-section-tab"));
      const initial = Array.from(host.querySelectorAll("[data-section-panel]")).map((item) => item.hidden);
      tabs[0]?.click();
      const emptyText = host.querySelector(".siwords-definition-empty")?.textContent || "";
      const after = Array.from(host.querySelectorAll("[data-section-panel]")).map((item) => item.hidden);
      host.remove();
      return { labels: tabs.map((item) => item.textContent.trim()), initial, after, emptyText, raw: value };
    });
    assert.deepStrictEqual(expansionOnlyTabs.labels, ["释义", "✦ 词汇扩展"]);
    assert.deepStrictEqual(expansionOnlyTabs.initial, [true, false], "expansion-only entries should open on useful content");
    assert.deepStrictEqual(expansionOnlyTabs.after, [false, true]);
    assert.match(expansionOnlyTabs.emptyText, /还没有基础释义/);
    assert.equal(expansionOnlyTabs.raw.includes("还没有基础释义"), false, "the empty state must remain UI-only");

    await page.evaluate(() => {
      window.plugin.generateVocabularyExpansion = async () => ({
        wordFamily: [{ word: "aimed", meaning: "有目标的" }],
        synonyms: [],
        confusables: [],
      });
      return window.__commands.expandCurrentWordRelations.callback();
    });
    await page.waitForFunction(() => document.querySelector('[data-field="definition"]')?.value.includes("#### aimed"));
    definition = await page.locator('[data-field="definition"]').inputValue();
    assert.equal((definition.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1, "shortcut rerun must replace the generated section");
    assert.equal(definition.includes("#### aimless"), false);
    assert.equal(definition.startsWith("手工释义：力求做到某事。"), true);

    await page.evaluate(() => {
      window.plugin.generateDefinition = () => new Promise((resolve) => { window.__resolveDefinition = resolve; });
    });
    await page.locator('[data-action="quick-ai"]').click();
    const liveEditedDefinition = `USER_EDITED_BASE\n\n---\n**我的笔记**\nNOTE_DURING_REQUEST\n\n${definition.slice(definition.indexOf("---\n**词汇扩展（AI）**"))}`;
    await page.locator('[data-field="definition"]').fill(liveEditedDefinition);
    await page.evaluate(() => window.__resolveDefinition("AI_NEW_BASE"));
    await page.waitForFunction(() => document.querySelector('[data-role="quick-status"]')?.textContent.includes("其他分节与词汇扩展已保留"));
    const afterDefinitionAI = await page.locator('[data-field="definition"]').inputValue();
    assert.equal(afterDefinitionAI.startsWith("AI_NEW_BASE"), true);
    assert.equal(afterDefinitionAI.includes("USER_EDITED_BASE"), false);
    assert.equal(afterDefinitionAI.includes("NOTE_DURING_REQUEST"), true, "manual edits made during the request must survive");
    assert.equal(afterDefinitionAI.includes("#### aimed"), true, "AI definition must not delete vocabulary expansion");
    assert.equal((afterDefinitionAI.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1);

    await page.locator('[data-action="quick-cancel"]').click();
    const inlineSetup = await page.evaluate(async () => {
      document.getElementById("relation-format-preview")?.remove();
      const raw = "**词汇扩展（AI）**\n### 同根词\n\n#### finder · *noun*\n**释义**：发现者\n\n---\n**我的笔记**\nNOTE_SENTINEL  \n\n---";
      const core = window.PluginClass.__test;
      const word = core.normalizeWord({
        id: "inline-primary-word",
        word: "findings",
        definition: raw,
        rawDefinition: raw,
        sentence: "The findings remain important.",
        sourceTitle: "试卷 1",
        bookId: window.plugin.state.books[0].id,
      }, window.plugin.state.books[0].id);
      window.plugin.state.words = [word];
      window.plugin.rebuildMatcher();
      window.__inlineRaw = raw;
      const revision = window.plugin.state.revision;
      const pop = window.plugin.showPopover(word, 24, 60);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        revision,
        labels: [...pop.querySelectorAll(".siwords-section-tab")].map((item) => item.textContent.trim()),
        active: [...pop.querySelectorAll(".siwords-section-tab")].findIndex((item) => item.getAttribute("aria-selected") === "true"),
        completeEditLabel: pop.querySelector('[data-action="edit"]')?.textContent.trim(),
      };
    });
    assert.deepStrictEqual(inlineSetup.labels, ["释义", "✦ 词汇扩展", "我的笔记"]);
    assert.equal(inlineSetup.active, 1, "an expansion-only entry should still open on useful content");
    assert.equal(inlineSetup.completeEditLabel, "完整编辑");

    await page.locator('.siwords-popover .siwords-section-tab[data-section-kind="primary"]').click();
    assert.equal(await page.locator('.siwords-popover [data-role="primary-definition-input"]').count(), 1, "clicking an empty definition tab must open the focused inline editor");
    assert.equal(await page.locator('.siwords-popover [data-role="primary-definition-input"]').inputValue(), "");
    assert.equal(await page.locator(".siwords-quick-add").count(), 0, "focused definition editing must not expose the full Markdown dialog");
    const inlineLayout = await page.evaluate(() => {
      const pop = document.querySelector(".siwords-popover").getBoundingClientRect();
      const actions = document.querySelector(".siwords-inline-definition-editor__actions").getBoundingClientRect();
      return { popTop: pop.top, popBottom: pop.bottom, actionTop: actions.top, actionBottom: actions.bottom };
    });
    assert.ok(inlineLayout.actionTop >= inlineLayout.popTop && inlineLayout.actionBottom <= inlineLayout.popBottom, "focused editor actions must be visible without scrolling the word window");
    if (process.env.SIWORDS_CAPTURE_INLINE_EDITOR === "1") {
      await page.locator(".siwords-popover").screenshot({
        path: path.resolve(__dirname, "../artifacts/inline-definition-editor-0.6.7.png"),
      });
    }
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').fill("UNSAVED_DRAFT");
    await page.evaluate(() => window.plugin.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
    assert.equal(await page.locator(".siwords-popover").count(), 1, "the first Escape must cancel inline editing instead of closing the word window");
    assert.equal(await page.locator('.siwords-popover [data-role="primary-definition-input"]').count(), 0);
    assert.equal(await page.evaluate(() => window.plugin.state.revision), inlineSetup.revision, "cancel must not write state");
    assert.equal(await page.evaluate(() => window.plugin.state.words[0].rawDefinition), await page.evaluate(() => window.__inlineRaw));

    await page.locator('.siwords-popover .siwords-section-tab[data-section-kind="primary"]').click();
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').fill("NEW INLINE BASE\n\nOnly the primary definition changed.");
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').press("Control+Enter");
    await page.waitForFunction(() => !document.querySelector('.siwords-popover [data-role="primary-definition-input"]'));
    const inlineSaved = await page.evaluate(() => {
      const word = window.plugin.state.words[0];
      const raw = word.rawDefinition;
      const original = window.__inlineRaw;
      const originalSuffix = original.slice(original.indexOf("**词汇扩展（AI）**"));
      const savedSuffix = raw.slice(raw.indexOf("**词汇扩展（AI）**"));
      const pop = document.querySelector(".siwords-popover");
      return {
        raw,
        suffixExact: savedSuffix === originalSuffix,
        pinned: Boolean(pop?.__siwordsPinned),
        primaryEmpty: pop?.querySelector('.siwords-section-tab[data-section-kind="primary"]')?.dataset.primaryEmpty,
        message: window.__messages.at(-1),
      };
    });
    assert.equal(inlineSaved.raw.startsWith("NEW INLINE BASE"), true);
    assert.equal(inlineSaved.suffixExact, true, "inline save must preserve expansion and manual sections byte-for-byte");
    assert.equal((inlineSaved.raw.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1);
    assert.equal(inlineSaved.raw.includes("NOTE_SENTINEL  "), true, "Markdown hard-break spaces in manual sections must survive");
    assert.equal(inlineSaved.pinned, false, "saving must restore normal hover dismissal when the window was not pinned before editing");
    assert.equal(inlineSaved.primaryEmpty, "false");
    assert.match(inlineSaved.message, /基础释义已保存/);
    assert.equal(await page.locator('.siwords-popover [data-action="edit-primary-definition"]').count(), 1, "saved definitions need a clear re-edit action");

    await page.locator('.siwords-popover [data-action="edit-primary-definition"]').click();
    const isolatedEditorValue = await page.locator('.siwords-popover [data-role="primary-definition-input"]').inputValue();
    assert.equal(isolatedEditorValue.includes("词汇扩展"), false, "the primary editor must never expose expansion Markdown");
    assert.equal(isolatedEditorValue.includes("NOTE_SENTINEL"), false, "the primary editor must never expose manual sections");
    await page.locator('.siwords-popover [data-action="cancel-primary-definition"]').click();

    const beforeNoop = await page.evaluate(() => ({
      raw: window.plugin.state.words[0].rawDefinition,
      revision: window.plugin.state.revision,
    }));
    await page.locator('.siwords-popover [data-action="edit-primary-definition"]').click();
    assert.equal(await page.locator('.siwords-popover [data-action="save-primary-definition"]').isDisabled(), true, "unchanged content must not offer a write");
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').press("Control+Enter");
    assert.equal(await page.locator('.siwords-popover [data-role="primary-definition-input"]').count(), 0, "an unchanged keyboard save should simply leave edit mode");
    const afterNoop = await page.evaluate(() => ({
      raw: window.plugin.state.words[0].rawDefinition,
      revision: window.plugin.state.revision,
    }));
    assert.deepStrictEqual(afterNoop, beforeNoop, "no-op save must preserve raw Markdown and revision exactly");

    await page.locator('.siwords-popover [data-action="edit-primary-definition"]').click();
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').fill("SHOULD_ROLL_BACK");
    await page.evaluate(() => {
      window.__originalCommitChange = window.plugin.commitChange;
      window.plugin.commitChange = async () => { throw new Error("disk failed"); };
    });
    await page.locator('.siwords-popover [data-role="primary-definition-input"]').press("Control+Enter");
    await page.waitForFunction(() => document.querySelector('[data-role="primary-definition-status"]')?.textContent.includes("保存失败"));
    assert.equal(await page.locator('.siwords-popover [data-role="primary-definition-input"]').inputValue(), "SHOULD_ROLL_BACK", "failed saves must retain the draft");
    const afterFailure = await page.evaluate(() => ({
      raw: window.plugin.state.words[0].rawDefinition,
      revision: window.plugin.state.revision,
    }));
    assert.deepStrictEqual(afterFailure, beforeNoop, "failed saves must roll back in-memory state as well as leave the editor open");
    await page.evaluate(() => {
      window.plugin.commitChange = window.__originalCommitChange;
      delete window.__originalCommitChange;
      window.plugin.cancelPopoverPrimaryDefinitionEdit(document.querySelector(".siwords-popover"), { confirmDiscard: false });
    });

    await page.locator('.siwords-popover [data-action="edit"]').click();
    assert.equal(await page.locator(".siwords-quick-add").count(), 1, "complete edit must remain available as the advanced path");
    assert.match(await page.locator('[data-field="definition"]').inputValue(), /\*\*词汇扩展（AI）\*\*/);
    assert.match(await page.locator('.siwords-quick-add [data-role="quick-status"]').innerText(), /完整编辑入口/);
    await page.locator('[data-action="quick-cancel"]').click();

    process.stdout.write("PASS selection shortcut, expansion, isolated primary editing, section preservation and narrow dialog\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
