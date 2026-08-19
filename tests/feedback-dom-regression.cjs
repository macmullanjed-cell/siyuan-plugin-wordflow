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
        --b3-theme-background:#17151d; --b3-theme-surface:#211e2a;
        --b3-theme-on-background:#f3efff; --b3-theme-on-surface:#bdb6cf;
        --b3-border-color:#4a435c; --b3-theme-primary:#b39afb;
        --b3-list-hover:#342d43; --b3-card-error-color:#ff8f86;
      }
      html,body{margin:0;width:100%;height:100%;overflow:hidden}
      .b3-dialog{position:fixed;inset:0;display:grid;place-items:center}
      .b3-dialog__container{overflow:hidden;background:var(--b3-theme-surface)}
    </style>`);
    await page.addStyleTag({ path: path.resolve(__dirname, "../index.css") });
    await page.evaluate(() => {
      document.documentElement.dataset.themeMode = "dark";
      window.__appearanceReads = 0;
      window.__pluginReads = 0;
      const config = { system: { kernelVersion: "3.7.0", os: "Windows", osVersion: "11 24H2" } };
      Object.defineProperty(config, "appearance", {
        get() { window.__appearanceReads += 1; return { mode: 1, themeDark: "Midnight" }; },
      });
      window.siyuan = { config };
      window.__messages = [];
      window.__anchors = [];
      class MockPlugin {
        constructor() {
          this.name = "siyuan-plugin-wordflow";
          this.app = {};
          Object.defineProperty(this.app, "plugins", {
            get() { window.__pluginReads += 1; return [{ name: "siyuan-plugin-wordflow" }, { name: "Example Plugin" }]; },
          });
        }
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
      document.addEventListener("click", (event) => {
        const anchor = event.target.closest?.("a[href]");
        if (!anchor) return;
        event.preventDefault();
        window.__anchors.push({ href: anchor.href, copyResolved: Boolean(window.__copyResolved) });
      }, true);
    });
    await page.addScriptTag({ path: path.resolve(__dirname, "../index.js") });
    await page.evaluate(() => {
      window.PluginClass = window.module.exports;
      window.plugin = new window.PluginClass();
      window.plugin.feedbackDraft = window.PluginClass.__test.normalizeFeedbackDraft();
      window.__copied = [];
      window.plugin.copyFeedbackText = async (text) => { window.__copied.push(text); return true; };
      window.plugin.openFeedbackDialog("bug");
    });

    const root = page.locator(".siwords-feedback");
    assert.equal(await root.count(), 1);
    assert.equal(await page.locator('[data-action="feedback-copy"]').isEnabled(), true, "copy must always be available");
    assert.equal(await page.locator('[data-action="feedback-github"]').isDisabled(), true, "GitHub must require preview");
    const bounds = await root.boundingBox();
    assert.ok(bounds.width <= 390 && bounds.height <= 700, `dialog must fit viewport: ${JSON.stringify(bounds)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "dialog must not overflow horizontally");

    await page.locator('[data-feedback-field="description"]').fill("悬停词卡超出页面");
    await page.locator('[data-feedback-field="steps"]').fill("1. 打开窄窗口\n2. 悬停单词");
    await page.locator('[data-feedback-field="expected"]').fill("词卡保持可见");
    await page.locator('[data-feedback-field="actual"]').fill("右侧被裁切");
    await page.locator('[data-action="feedback-copy"]').click();
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.deepStrictEqual(await page.evaluate(() => [window.__appearanceReads, window.__pluginReads]), [0, 0], "unchecked optional diagnostics must not be read");
    await page.locator('[data-feedback-field="includeTheme"]').check();
    await page.locator('[data-feedback-field="includePlugins"]').check();
    await page.locator('[data-action="feedback-copy"]').click();
    await page.waitForFunction(() => window.__copied.length === 2);
    const copied = await page.evaluate(() => window.__copied[1]);
    assert.match(copied, /思源：3\.7\.0/);
    assert.match(copied, /当前主题：Midnight（深色）/);
    assert.match(copied, /已启用的其他插件：Example Plugin/);

    await page.locator('[data-action="feedback-preview"]').click();
    assert.equal(await page.locator('[data-action="feedback-github"]').isEnabled(), true);
    assert.equal(await page.locator('[data-role="feedback-preview"]').isVisible(), true);
    await page.locator('[data-feedback-field="actual"]').fill("修改后的实际结果");
    assert.equal(await page.locator('[data-action="feedback-github"]').isDisabled(), true, "editing must invalidate preview");
    await page.locator('[data-action="feedback-preview"]').click();

    await page.evaluate(() => {
      window.__copyResolved = false;
      window.plugin.copyFeedbackText = (text) => {
        window.__copied.push(text);
        return new Promise((resolve) => {
          window.__resolveCopy = () => { window.__copyResolved = true; resolve(true); };
        });
      };
    });
    await page.locator('[data-action="feedback-github"]').click();
    await page.waitForFunction(() => window.__anchors.length === 1);
    const anchor = await page.evaluate(() => window.__anchors[0]);
    assert.equal(anchor.copyResolved, false, "GitHub link must open before async clipboard resolution loses the user gesture");
    const issue = new URL(anchor.href);
    assert.equal(issue.searchParams.get("template"), "bug.yml");
    assert.equal(issue.searchParams.get("description"), "悬停词卡超出页面");
    await page.evaluate(() => window.__resolveCopy());
    await page.waitForFunction(() => window.__copyResolved === true);

    await page.locator('[data-action="feedback-close"]').click();
    await page.evaluate(() => window.plugin.openFeedbackDialog("bug"));
    assert.equal(await page.locator('[data-feedback-field="description"]').inputValue(), "悬停词卡超出页面");
    assert.equal(await page.locator('[data-feedback-field="actual"]').inputValue(), "修改后的实际结果");
    assert.equal(await page.locator('[data-action="feedback-github"]').isDisabled(), true, "reopened session draft still requires a fresh preview");

    process.stdout.write("PASS feedback dialog privacy, preview gate, draft retention, popup timing and narrow layout\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
