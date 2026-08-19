"use strict";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
class MockPlugin {}
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
const diagnostics = {
  pluginVersion: "0.6.3",
  siyuanVersion: "3.7.0",
  os: "Windows 11 24H2",
  theme: "Daylight（浅色）",
  plugins: "Plugin A、Plugin B",
  apiKey: "must-not-appear",
  documentText: "must-not-appear",
};

function parseIssueUrl(url) {
  const parsed = new URL(url);
  return { parsed, params: parsed.searchParams };
}

const normalized = core.normalizeFeedbackDraft({ type: "unknown", description: "x".repeat(5000) });
assert.equal(normalized.type, "bug");
assert.equal(normalized.description.length, 4000);
assert.equal(core.feedbackDraftSignature(normalized), core.feedbackDraftSignature({ ...normalized }));

const privateByDefault = core.buildFeedbackReport({
  type: "bug",
  description: "划词后按钮没有出现",
  steps: "1. 打开文档\n2. 划词",
  expected: "出现添加按钮",
  actual: "没有按钮",
}, diagnostics);
assert.match(privateByDefault, /SiWords：0\.6\.3/);
assert.match(privateByDefault, /思源：3\.7\.0/);
assert.match(privateByDefault, /操作系统：Windows 11 24H2/);
assert.doesNotMatch(privateByDefault, /Daylight|Plugin A|must-not-appear/);
assert.match(privateByDefault, /未自动附带文档正文、PDF 内容、词库、原句、API 地址或 API Key/);

const optionalDiagnostics = core.buildFeedbackReport({
  type: "ui",
  description: "词卡溢出",
  includeTheme: true,
  includePlugins: true,
}, diagnostics);
assert.match(optionalDiagnostics, /当前主题：Daylight（浅色）/);
assert.match(optionalDiagnostics, /已启用的其他插件：Plugin A、Plugin B/);

const bug = parseIssueUrl(core.buildFeedbackIssueUrl({
  type: "selection",
  description: "划词失败",
  steps: "1. 划词",
  expected: "出现按钮",
  actual: "没有反应",
}, diagnostics));
assert.equal(bug.params.get("template"), "bug.yml");
assert.equal(bug.params.get("surface"), "思源文档划词或高亮");
assert.equal(bug.params.get("siwords-version"), "0.6.3");
assert.equal(bug.params.get("description"), "划词失败");
assert.equal(bug.params.has("body"), false, "must use issue-form field ids instead of blank issue body");

const performance = parseIssueUrl(core.buildFeedbackIssueUrl({
  type: "performance",
  description: "添加一个单词需要三秒",
  steps: "重复添加三次",
  expected: "一秒内完成",
  actual: "明显卡顿",
}, diagnostics));
assert.equal(performance.params.get("template"), "performance.yml");
assert.equal(performance.params.get("operation"), "其他");
assert.match(performance.params.get("versions"), /SiWords 0\.6\.3；思源 3\.7\.0/);
assert.equal(performance.params.get("steps"), "重复添加三次");

const feature = parseIssueUrl(core.buildFeedbackIssueUrl({
  type: "feature",
  description: "希望批量标记掌握",
  expected: "可以一次选择多个词",
  actual: "目前逐个操作",
}, diagnostics));
assert.equal(feature.params.get("template"), "feature.yml");
assert.equal(feature.params.get("problem"), "希望批量标记掌握");
assert.equal(feature.params.get("proposal"), "可以一次选择多个词");
assert.equal(feature.params.get("area"), "其他");

const longUrl = core.buildFeedbackIssueUrl({
  type: "bug",
  description: "长".repeat(4000),
  steps: "骤".repeat(4000),
  expected: "预".repeat(2500),
  actual: "实".repeat(2500),
}, diagnostics);
const long = parseIssueUrl(longUrl);
assert.ok(longUrl.length < 8000, `long issue URL must stay safe, got ${longUrl.length}`);
assert.equal(long.params.get("template"), "bug.yml");
assert.match(long.params.get("description"), /完整内容已复制/);

process.stdout.write("PASS feedback report, privacy defaults, issue-form mapping and long-URL fallback\n");
