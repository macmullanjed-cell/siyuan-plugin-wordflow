"use strict";

const assert = require("assert");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.setDefaultTimeout(10000);
  try {
    await page.setContent(`
      <style>
        :root {
          --b3-theme-background: #fbfaff;
          --b3-theme-surface: #ffffff;
          --b3-theme-on-background: #2d2738;
          --b3-theme-on-surface: #675f73;
          --b3-border-color: #ded8e8;
          --b3-list-hover: #f0ecfa;
        }
        #surface { position: fixed; left: 40px; top: 40px; width: 760px; padding: 20px; font: 18px/1.6 Arial; }
        .siwords-popover { position: fixed; width: 340px; max-height: 420px; padding: 12px; background: white; }
        .siwords-float, .siwords-translate-popover { position: fixed; }
      </style>
      <section class="protyle">
        <div class="protyle-title__input" data-node-id="doc-hover">Hover regression</div>
        <div id="surface" class="protyle-wysiwyg" data-doc-id="doc-hover">
          <p id="block" data-node-id="block-hover"><span id="target">average appears in this examination sentence.</span></p>
        </div>
      </section>
    `);
    await page.addStyleTag({ path: path.resolve(__dirname, "../index.css") });
    await page.evaluate(() => {
      window.__messages = [];
      window.confirm = () => true;
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
      class MockDialog {
        constructor(options) { this.element = document.createElement("div"); this.element.innerHTML = options.content; document.body.appendChild(this.element); }
        destroy() { this.element.remove(); }
      }
      window.require = (name) => {
        if (name !== "siyuan") throw new Error(`Unexpected require: ${name}`);
        return { Plugin: MockPlugin, Dialog: MockDialog, showMessage(value) { window.__messages.push(String(value)); }, openTab() { return Promise.resolve({}); } };
      };
      window.module = { exports: {} };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, "../index.js") });
    const result = await page.evaluate(async () => {
      const PluginClass = window.module.exports;
      const core = PluginClass.__test;
      const plugin = new PluginClass();
      await plugin.onload();
      plugin.state.words = [core.normalizeWord({
        id: "word-average",
        word: "average",
        definition: "adj. 平均的；普通的\n\n## 同根词\naverageable",
        bookId: plugin.state.books[0].id,
      }, plugin.state.books[0].id)];
      Object.assign(plugin.state.settings, {
        showDefinitionOnHover: true,
        hoverDelay: 80,
        showSelectionButton: true,
        enableSelectionTranslate: false,
        aiEnabled: false,
      });
      plugin.rebuildMatcher();

      const surface = document.getElementById("surface");
      const block = document.getElementById("block");
      const span = document.getElementById("target");
      const textNode = span.firstChild;
      const caret = document.createRange();
      caret.setStart(textNode, 2);
      caret.collapse(true);
      const wordRange = document.createRange();
      wordRange.setStart(textNode, 0);
      wordRange.setEnd(textNode, "average".length);
      const wordRect = wordRange.getBoundingClientRect();
      const x = wordRect.left + wordRect.width / 2;
      const y = wordRect.top + wordRect.height / 2;
      const originalCaretRangeFromPoint = document.caretRangeFromPoint;
      document.caretRangeFromPoint = () => caret;

      let showCalls = 0;
      const originalShowPopover = plugin.showPopover.bind(plugin);
      plugin.showPopover = (...args) => { showCalls += 1; return originalShowPopover(...args); };
      plugin.inspectPoint(x, y);
      const firstPopover = document.querySelector(".siwords-popover");
      for (let index = 0; index < 25; index += 1) plugin.inspectPoint(x + (index % 2), y);
      const samePopover = document.querySelector(".siwords-popover");
      const sameWordReuse = firstPopover === samePopover && showCalls === 1 && document.querySelectorAll(".siwords-popover").length === 1;

      plugin.hidePopover();
      showCalls = 0;
      plugin.inspectPoint(wordRect.right + 30, y);
      const whitespaceRejected = showCalls === 0 && !document.querySelector(".siwords-popover");

      plugin.onPointerMove({ target: span, clientX: x, clientY: y, buttons: 1, pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dragSuppressed = !plugin.hoverTimer && !document.querySelector(".siwords-popover");

      plugin.onPointerMove({ target: span, clientX: x, clientY: y, buttons: 0, pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 40));
      plugin.onPointerMove({ target: span, clientX: x + 2, clientY: y, buttons: 0, pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 55));
      const smallMovementDoesNotStarve = Boolean(document.querySelector(".siwords-popover"));

      plugin.hidePopover();
      window.getSelection().removeAllRanges();
      plugin.onSelectionChange();
      const selectionRange = document.createRange();
      selectionRange.setStart(textNode, 0);
      selectionRange.setEnd(textNode, "average".length);
      window.getSelection().addRange(selectionRange);
      plugin.onSelectionChange();
      showCalls = 0;
      plugin.inspectPoint(x, y);
      const selectionSuppressesHover = showCalls === 0;
      plugin.onMouseUp({ button: 0, target: span });
      await new Promise((resolve) => setTimeout(resolve, 75));
      const selectionWins = Boolean(document.querySelector(".siwords-float")) && !document.querySelector(".siwords-popover");
      window.getSelection().removeAllRanges();
      plugin.onSelectionChange();
      plugin.removeFloat();

      plugin.invalidateSurfaceCache(surface);
      let mapBuilds = 0;
      const originalCollect = plugin.collectTextMap.bind(plugin);
      plugin.collectTextMap = (...args) => { mapBuilds += 1; return originalCollect(...args); };
      plugin.findSurfaceMatchAtRange(surface, caret, block);
      plugin.findSurfaceMatchAtRange(surface, caret, block);
      const localCacheReused = mapBuilds === 1;
      plugin.collectTextMap = originalCollect;

      plugin.invalidateSurfaceCache(surface);
      const oldRecord = plugin.getSurfaceRecord(surface);
      oldRecord.at = 0;
      mapBuilds = 0;
      plugin.collectTextMap = (...args) => { mapBuilds += 1; return originalCollect(...args); };
      const sameRecord = plugin.getSurfaceRecord(surface);
      const noTimeBasedColdRescan = sameRecord === oldRecord && mapBuilds === 0;
      plugin.collectTextMap = originalCollect;

      plugin.inspectPoint(x, y);
      const popover = document.querySelector(".siwords-popover");
      plugin.onViewportChange({ type: "scroll", target: popover?.querySelector(".siwords-definition") || popover });
      const internalScrollSurvives = Boolean(popover?.isConnected);

      const anchor = popover?.__siwordsFloatingAnchor;
      const beforePlacement = popover?.dataset?.placement || "";
      if (popover) {
        popover.style.height = "400px";
        plugin.positionFloatingElement(popover, anchor.anchorX, anchor.anchorY, anchor.options);
      }
      const placementLocked = Boolean(beforePlacement) && popover?.dataset?.placement === beforePlacement;

      plugin.hidePopover();
      const visualWord = core.normalizeWord({
        id: "visual-properly",
        word: "properly",
        definition: "adv. 适当地；正确地；真正地\n\n## 词根\nproper 本身固有 + -er + -ly 副词后缀\n\n## 同根词\nproper adj. 合适的；恰当的",
        sentence: "The material can be properly recycled when each component is separated.",
        sourceTitle: "六级阅读练习 · 词库",
        bookId: plugin.state.books[0].id,
      }, plugin.state.books[0].id);
      const preferredPopover = plugin.showPopover(visualWord, 260, 300);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const preferredRect = preferredPopover.getBoundingClientRect();
      const prefersBelow = preferredPopover.dataset.placement === "below" && preferredRect.top >= 309 && preferredRect.bottom <= innerHeight - 8;

      plugin.hidePopover();
      visualWord.id = "visual-properly-bottom";
      const bottomPopover = plugin.showPopover(visualWord, 260, innerHeight - 24);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bottomRect = bottomPopover.getBoundingClientRect();
      const flipsAboveAtBottom = bottomPopover.dataset.placement === "above" && bottomRect.top >= 8 && bottomRect.bottom < innerHeight - 24;

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const openRetentionPopover = async (id) => {
        plugin.hidePopover();
        const entry = { ...visualWord, id };
        const element = plugin.showPopover(entry, 80, 240);
        await nextFrame();
        return element;
      };
      const pointerMove = (target, point) => plugin.onPointerMove({
        target,
        clientX: point.x,
        clientY: point.y,
        buttons: 0,
        pointerType: "mouse",
      });

      const twelvePixelPopover = await openRetentionPopover("visual-retention-12px");
      const twelvePixelRect = twelvePixelPopover.getBoundingClientRect();
      const twelvePixelPoint = {
        x: twelvePixelRect.right + 12,
        y: twelvePixelRect.top + twelvePixelRect.height / 2,
      };
      pointerMove(document.body, twelvePixelPoint);
      plugin.hidePopoverSoon(twelvePixelPoint);
      await wait(380);
      const twelvePixelSafeZoneSurvives = twelvePixelPopover.isConnected
        && plugin.activePopoverElement === twelvePixelPopover
        && !plugin.hideTimer;

      const thirtyPixelPopover = await openRetentionPopover("visual-retention-30px");
      const thirtyPixelRect = thirtyPixelPopover.getBoundingClientRect();
      const thirtyPixelPoint = {
        x: thirtyPixelRect.right + 30,
        y: thirtyPixelRect.top + thirtyPixelRect.height / 2,
      };
      pointerMove(document.body, thirtyPixelPoint);
      const thirtyPixelStartsDelayed = thirtyPixelPopover.isConnected && Boolean(plugin.hideTimer);
      await wait(180);
      const thirtyPixelSurvivesBeforeTimeout = thirtyPixelPopover.isConnected;
      await wait(190);
      const thirtyPixelClosesAfterTimeout = !thirtyPixelPopover.isConnected
        && !plugin.activePopoverElement
        && !plugin.hideTimer;

      const returnPopover = await openRetentionPopover("visual-retention-return");
      const returnRect = returnPopover.getBoundingClientRect();
      const returnOutsidePoint = {
        x: returnRect.right + 30,
        y: returnRect.top + returnRect.height / 2,
      };
      pointerMove(document.body, returnOutsidePoint);
      await wait(150);
      pointerMove(returnPopover, {
        x: returnRect.right - 4,
        y: returnRect.top + returnRect.height / 2,
      });
      await wait(230);
      const timelyReturnCancelsClose = returnPopover.isConnected
        && plugin.activePopoverElement === returnPopover
        && !plugin.hideTimer;

      const clickPopover = await openRetentionPopover("visual-retention-click-through");
      const clickRect = clickPopover.getBoundingClientRect();
      const clickPoint = {
        x: clickRect.right + 12,
        y: clickRect.top + clickRect.height / 2,
      };
      const underlyingTarget = document.elementFromPoint(clickPoint.x, clickPoint.y);
      const safeZoneHasNoOverlay = Boolean(underlyingTarget)
        && !underlyingTarget.closest?.(".siwords-popover")
        && !underlyingTarget.closest?.(".siwords-ui");
      plugin.onMouseDown({ target: underlyingTarget });
      const outsideClickStillCloses = !clickPopover.isConnected
        && !plugin.activePopoverElement
        && !plugin.hideTimer;

      document.caretRangeFromPoint = originalCaretRangeFromPoint;
      return {
        sameWordReuse,
        whitespaceRejected,
        dragSuppressed,
        smallMovementDoesNotStarve,
        selectionSuppressesHover,
        selectionWins,
        localCacheReused,
        noTimeBasedColdRescan,
        internalScrollSurvives,
        placementLocked,
        prefersBelow,
        flipsAboveAtBottom,
        twelvePixelSafeZoneSurvives,
        thirtyPixelStartsDelayed,
        thirtyPixelSurvivesBeforeTimeout,
        thirtyPixelClosesAfterTimeout,
        timelyReturnCancelsClose,
        safeZoneHasNoOverlay,
        outsideClickStillCloses,
      };
    });

    for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name);
    const screenshot = path.resolve(__dirname, "popover-purple-0.6.1.png");
    await page.screenshot({ path: screenshot, fullPage: false });
    process.stdout.write(JSON.stringify({ suite: "hover-stability-regression", passed: Object.keys(result).length, failed: 0, checks: result, screenshot }) + "\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
