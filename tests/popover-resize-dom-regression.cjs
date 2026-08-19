"use strict";

const assert = require("assert");
const path = require("path");
const { chromium } = require("playwright");

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const closeEnough = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.setDefaultTimeout(10000);
  try {
    await page.setContent(`
      <style>
        :root {
          --b3-theme-background:#fbfaff; --b3-theme-surface:#fff;
          --b3-theme-on-background:#292334; --b3-theme-on-surface:#655d70;
          --b3-border-color:#ddd6e7; --b3-list-hover:#f0ebfb;
        }
      </style>
    `);
    await page.evaluate(() => { document.documentElement.dataset.themeMode = "light"; });
    await page.addStyleTag({ path: path.resolve(__dirname, "../index.css") });
    await page.evaluate(() => {
      window.__messages = [];
      class MockPlugin {
        constructor() {
          this._data = {}; this.name = "siyuan-plugin-wordflow"; this.app = {};
          this.eventBus = { on() {}, off() {} };
        }
        async loadData(name) { return this._data[name] == null ? null : structuredClone(this._data[name]); }
        async saveData(name, value) { this._data[name] = structuredClone(value); }
        async removeData(name) { delete this._data[name]; }
        addIcons() {} addTab(value) { return value; } addDock(value) { return value; }
        addCommand() {} addTopBar() {}
      }
      class MockDialog {
        constructor(options) { this.element = document.createElement("div"); this.element.innerHTML = options.content; document.body.appendChild(this.element); }
        destroy() { this.element.remove(); }
      }
      window.require = (name) => {
        if (name !== "siyuan") throw new Error(`Unexpected require: ${name}`);
        return { Plugin: MockPlugin, Dialog: MockDialog, showMessage(value) { window.__messages.push(String(value)); }, openTab() {} };
      };
      window.module = { exports: {} };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, "../index.js") });
    const setup = await page.evaluate(async () => {
      const PluginClass = window.module.exports;
      const plugin = new PluginClass();
      await plugin.onload();
      plugin.captureViewportMetrics();
      const word = PluginClass.__test.normalizeWord({
        id: "resize-word-1",
        word: "findings",
        definition: "n. 调查结果；研究发现\n\n---\n\n**词汇扩展（AI）**\n\n### 同根词\n\n#### find · */faɪnd/* · *v.*\n**释义**：发现；**构词**：findings 是 find 的名词形式",
        sentence: "The findings contradict standard dietary advice across several countries.",
        sourceTitle: "试卷 1",
        bookId: plugin.state.books[0].id,
      }, plugin.state.books[0].id);
      window.plugin = plugin;
      window.resizeWord = word;
      const pop = plugin.showPopover(word, 310, 170);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const directions = [...pop.querySelectorAll("[data-resize-direction]")].map((item) => item.dataset.resizeDirection);
      return {
        directions,
        visible: getComputedStyle(pop.querySelector('[data-resize-direction="se"]')).display !== "none",
      };
    });
    assert.deepEqual(setup.directions, ["n", "ne", "e", "se", "s", "sw", "w", "nw"], "all eight handles must be present");
    assert.equal(setup.visible, true, "desktop resize handles should be active");

    const initial = await page.locator(".siwords-popover").boundingBox();
    const se = await page.locator('[data-resize-direction="se"]').boundingBox();
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.evaluate(() => document.querySelector(".siwords-popover").dispatchEvent(new MouseEvent("mouseleave")));
    await page.waitForTimeout(360);
    assert.equal(await page.locator(".siwords-popover").count(), 1, "mouseleave must not close a popover while resizing");
    await page.mouse.move(se.x + se.width / 2 + 120, se.y + se.height / 2 + 90);
    await page.mouse.up();
    const enlarged = await page.locator(".siwords-popover").boundingBox();
    assert(enlarged.width > initial.width + 80, "south-east drag should grow width");
    assert(enlarged.height > initial.height + 60, "south-east drag should grow height");
    await page.evaluate(() => document.querySelector(".siwords-popover").dispatchEvent(new MouseEvent("mouseleave")));
    await page.waitForTimeout(360);
    assert.equal(await page.locator(".siwords-popover").count(), 1, "a manually sized reading window must stay pinned after pointerup");
    assert.equal(await page.locator('[data-action="close"]').count(), 1, "a pinned reading window needs an explicit close control");
    await page.locator(".siwords-section-tab").nth(1).click();
    const selectedInside = await page.evaluate(() => {
      const panel = [...document.querySelectorAll(".siwords-section-panel")].find((item) => !item.hidden);
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && !textNode.textContent.trim()) textNode = walker.nextNode();
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(4, textNode.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.plugin.onSelectionChange();
      return selection.toString();
    });
    assert(selectedInside.length > 0, "the regression must create a real selection inside the pinned window");
    await page.waitForTimeout(360);
    assert.equal(await page.locator(".siwords-popover").count(), 1, "selecting or copying text inside a pinned window must not close it");
    assert.equal(await page.evaluate(() => window.getSelection().toString()), selectedInside, "the in-window selection must survive");
    await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      window.plugin.onSelectionChange();
    });
    if (process.env.SIWORDS_CAPTURE_RESIZE === "1") {
      await page.locator(".siwords-popover").screenshot({ path: path.resolve(__dirname, "../artifacts/resizable-popover-0.6.7.png") });
    }

    const beforeNorthWest = enlarged;
    const nw = await page.locator('[data-resize-direction="nw"]').boundingBox();
    await page.mouse.move(nw.x + nw.width / 2, nw.y + nw.height / 2);
    await page.mouse.down();
    await page.mouse.move(nw.x - 65, nw.y - 45);
    await page.mouse.up();
    const afterNorthWest = await page.locator(".siwords-popover").boundingBox();
    assert(afterNorthWest.x < beforeNorthWest.x - 40, "west edge should move left");
    assert(afterNorthWest.y < beforeNorthWest.y - 25, "north edge should move up");
    assert(closeEnough(afterNorthWest.x + afterNorthWest.width, beforeNorthWest.x + beforeNorthWest.width), "north-west drag must keep the opposite horizontal edge fixed");
    assert(closeEnough(afterNorthWest.y + afterNorthWest.height, beforeNorthWest.y + beforeNorthWest.height), "north-west drag must keep the opposite vertical edge fixed");

    let handle = await page.locator('[data-resize-direction="se"]').boundingBox();
    await page.mouse.move(handle.x + 4, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(1800, 1400);
    await page.mouse.up();
    const viewportClamped = await page.locator(".siwords-popover").boundingBox();
    assert(viewportClamped.x >= 9 && viewportClamped.y >= 9, "resized window must stay inside top/left viewport margins");
    assert(viewportClamped.x + viewportClamped.width <= 991, "resized window must stay inside right viewport margin");
    assert(viewportClamped.y + viewportClamped.height <= 711, "resized window must stay inside bottom viewport margin");

    handle = await page.locator('[data-resize-direction="se"]').boundingBox();
    await page.mouse.move(handle.x + 4, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(viewportClamped.x + 5, viewportClamped.y + 5);
    await page.mouse.up();
    const minimumClamped = await page.locator(".siwords-popover").boundingBox();
    assert(closeEnough(minimumClamped.width, 360), `minimum width should be 360px, got ${minimumClamped.width}`);
    assert(closeEnough(minimumClamped.height, 300), `minimum height should be 300px, got ${minimumClamped.height}`);

    const stable = await page.evaluate(async () => {
      const pop = document.querySelector(".siwords-popover");
      const before = pop.getBoundingClientRect();
      window.plugin.updateFloatingAnchor(pop, 900, 680);
      pop.querySelector(".siwords-section-panel,.siwords-definition").append(" extra content ".repeat(80));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = pop.getBoundingClientRect();
      return {
        before: { x: before.x, y: before.y, width: before.width, height: before.height },
        after: { x: after.x, y: after.y, width: after.width, height: after.height },
        placement: pop.dataset.placement,
        remembered: window.plugin.popoverUserSize,
      };
    });
    assert.deepEqual(stable.after, stable.before, "anchor updates and ResizeObserver must not move a manually sized window");
    assert.equal(stable.placement, "manual");
    assert(closeEnough(stable.remembered.width, 360) && closeEnough(stable.remembered.height, 300), "session size should be remembered");

    await page.evaluate(() => window.plugin.onKeyDown({ key: "Escape" }));
    assert.equal(await page.locator(".siwords-popover").count(), 0, "Escape must still close a pinned reading window");

    const crossBoundaryClosed = await page.evaluate(async () => {
      window.resizeWord.id = "resize-word-cross-boundary";
      const pop = window.plugin.showPopover(window.resizeWord, 610, 300);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      pop.__siwordsPinned = true;
      const outside = document.createElement("p");
      outside.id = "selection-outside";
      outside.textContent = "ordinary article text outside the SiWords window";
      document.body.appendChild(outside);
      const insideText = pop.querySelector(".siwords-definition,.siwords-section-panel").firstChild;
      const range = document.createRange();
      range.setStart(insideText, 0);
      range.setEnd(outside.firstChild, 8);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.plugin.onSelectionChange();
      const closed = !document.querySelector(".siwords-popover");
      selection.removeAllRanges();
      window.plugin.onSelectionChange();
      return closed;
    });
    assert.equal(crossBoundaryClosed, true, "a selection crossing the pinned window boundary must close it");

    const articleSelectionClosed = await page.evaluate(async () => {
      window.resizeWord.id = "resize-word-article-selection";
      window.plugin.showPopover(window.resizeWord, 610, 300);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const outside = document.querySelector("#selection-outside");
      const range = document.createRange();
      range.setStart(outside.firstChild, 0);
      range.setEnd(outside.firstChild, 8);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.plugin.onSelectionChange();
      const closed = !document.querySelector(".siwords-popover");
      selection.removeAllRanges();
      window.plugin.onSelectionChange();
      return closed;
    });
    assert.equal(articleSelectionClosed, true, "an ordinary article selection must retain the original close behavior");

    const reopened = await page.evaluate(async () => {
      window.resizeWord.id = "resize-word-2";
      const pop = window.plugin.showPopover(window.resizeWord, 610, 300);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = pop.getBoundingClientRect();
      return { width: rect.width, height: rect.height, userSized: pop.classList.contains("is-user-sized") };
    });
    assert(closeEnough(reopened.width, 360) && closeEnough(reopened.height, 300), "the next popover should reuse the session size");
    assert.equal(reopened.userSized, true);

    const east = await page.locator('[data-resize-direction="e"]').boundingBox();
    await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
    await page.mouse.down();
    const disposed = await page.evaluate(() => {
      window.plugin.hidePopover();
      return {
        activeSession: Boolean(window.plugin.popoverResizeSession),
        resizeClass: document.documentElement.classList.contains("siwords-is-resizing"),
      };
    });
    await page.mouse.up();
    assert.equal(disposed.activeSession, false, "disposing a dragged popover must remove document listeners");
    assert.equal(disposed.resizeClass, false, "disposing must clear global resize state");

    await page.setViewportSize({ width: 600, height: 500 });
    const narrow = await page.evaluate(async () => {
      window.resizeWord.id = "resize-word-narrow";
      window.plugin.captureViewportMetrics();
      const pop = window.plugin.showPopover(window.resizeWord, 580, 470);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = pop.getBoundingClientRect();
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        handleDisplay: getComputedStyle(pop.querySelector('[data-resize-direction="se"]')).display,
      };
    });
    assert.equal(narrow.handleDisplay, "none", "narrow viewports should hide resize handles");
    assert(narrow.left >= 8 && narrow.top >= 8 && narrow.right <= 592 && narrow.bottom <= 492, `narrow popover overflowed: ${JSON.stringify(narrow)}`);

    await page.evaluate(() => window.plugin.onunload());
    process.stdout.write("PASS popover eight-way resize, clamp, stability, memory, narrow fallback and cleanup\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
