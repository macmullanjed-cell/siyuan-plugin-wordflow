"use strict";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
class MockPlugin {
  constructor() {
    this.name = "siyuan-plugin-wordflow";
    this.app = {};
    this.eventBus = { on() {}, off() {} };
  }
  addCommand() {}
}
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "siyuan") return {
    Plugin: MockPlugin,
    Dialog: class Dialog {},
    showMessage() {},
    openTab() { return Promise.resolve({}); },
  };
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require("../index.js");
const core = PluginClass.__test;

(async () => {
  const raw = JSON.stringify({
    wordFamily: [
      { word: "aim", meaning: "目标词自身" },
      { word: "aimless", phonetic: "/ˈeɪmləs/", pos: "adj.", meaning: "无目标的", note: "aim + -less" },
      { word: "aimlessly", pos: "adv.", meaning: "漫无目的地" },
      { word: "aimlessness", pos: "n.", meaning: "无目标" },
      { word: "aimed", pos: "adj.", meaning: "针对的" },
    ],
    synonyms: [
      { word: "intend", pos: "v.", meaning: "打算", note: "更强调明确意图" },
      { word: "target", pos: "v.", meaning: "以……为目标" },
      { word: "seek", pos: "v.", meaning: "力求" },
      { word: "plan", pos: "v.", meaning: "计划" },
    ],
    confusables: [
      { word: "intend", meaning: "跨类别重复，必须移除" },
      { word: "arm", pos: "n./v.", meaning: "手臂；武装", note: "拼写相近但含义不同" },
      { word: "air", meaning: "空气" },
      { word: "aid", meaning: "帮助" },
      { word: "aiming---\n<script>alert(1)</script>", meaning: "恶意\n换行" },
    ],
  });
  const parsed = core.parseVocabularyExpansionResponse(`\n\`\`\`json\n${raw}\n\`\`\`\n`, "AIM", 3);
  assert.deepStrictEqual(parsed.wordFamily.map((item) => item.word), ["aimless", "aimlessly", "aimlessness"]);
  assert.deepStrictEqual(parsed.synonyms.map((item) => item.word), ["intend", "target", "seek"]);
  assert.deepStrictEqual(parsed.confusables.map((item) => item.word), ["arm", "air", "aid"]);
  assert.equal(parsed.wordFamily.length <= 3 && parsed.synonyms.length <= 3 && parsed.confusables.length <= 3, true);

  assert.throws(() => core.parseVocabularyExpansionResponse("not json", "aim", 3), /JSON/);
  assert.throws(() => core.parseVocabularyExpansionResponse('{"wordFamily":[],"synonyms":[],"confusables":[]}', "aim", 3), /没有返回可靠/);
  assert.equal(core.clampVocabularyExpansionLimit(99), 3);
  assert.equal(core.clampVocabularyExpansionLimit(0), 3);
  assert.equal(core.applyTemplate("{{word}}|{{max}}", { word: "aim", max: 2 }), "aim|2");

  const markdown = core.formatVocabularyExpansionMarkdown(parsed);
  assert.match(markdown, /^### 同根词/m);
  assert.match(markdown, /^### 近义词/m);
  assert.match(markdown, /^### 形近 \/ 易混词/m);
  assert.equal((markdown.match(/^#### /gm) || []).length, 9);
  assert.equal((markdown.match(/^\d+\. /gm) || []).length, 0, "relation entries are not ranked");
  assert.match(markdown, /^#### aimless · \*\/ˈeɪmləs\/\* · \*adj\.\*$/m);
  assert.match(markdown, /^\*\*释义\*\*：无目标的；\*\*构词\*\*：aim \+ -less$/m);
  assert.match(markdown, /^\*\*释义\*\*：打算；\*\*辨析\*\*：更强调明确意图$/m);
  assert.match(markdown, /^\*\*释义\*\*：手臂；武装；\*\*区别\*\*：拼写相近但含义不同$/m);
  assert.equal(markdown.includes("<script>"), false);
  assert.equal(markdown.includes("\n---\n"), false);

  const sparseMarkdown = core.formatVocabularyExpansionMarkdown({
    wordFamily: [],
    synonyms: [{ word: "intend", meaning: "打算" }],
    confusables: [],
  });
  assert.equal((sparseMarkdown.match(/_本次未返回可靠结果。_/g) || []).length, 2);
  assert.equal((sparseMarkdown.match(/^#### /gm) || []).length, 1);
  const defensiveMarkdown = core.formatVocabularyExpansionMarkdown({
    wordFamily: [{ word: "bare", pos: "adj." }],
    synonyms: [],
    confusables: [],
  });
  assert.equal((defensiveMarkdown.match(/^#### /gm) || []).length, 0);
  assert.equal((defensiveMarkdown.match(/_本次未返回可靠结果。_/g) || []).length, 3);

  const bareFiltered = core.parseVocabularyExpansionResponse(JSON.stringify({
    wordFamily: [{ word: "bare", pos: "adj." }, { word: "useful", note: "与目标词有可靠构词关系" }],
    synonyms: [],
    confusables: [],
  }), "aim", 3);
  assert.deepStrictEqual(bareFiltered.wordFamily.map((item) => item.word), ["useful"]);

  const original = "手工释义 **必须保留**  \n第二行\n\n---\n**我的笔记**\n不要覆盖";
  const first = core.upsertVocabularyExpansionSection(original, markdown);
  assert.equal(first.startsWith(original), true, "first insertion must preserve the original definition byte-for-byte");
  assert.equal((first.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1);
  const replacement = markdown.replace("aimless", "purposeful");
  const second = core.upsertVocabularyExpansionSection(first, replacement);
  assert.equal(second.startsWith(original), true, "rerun must preserve all manual sections");
  assert.equal(second.includes("purposeful"), true);
  assert.equal(second.includes("#### aimless ·"), false);
  assert.equal((second.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1, "rerun must replace, not append");

  const generatedInMiddle = [
    "Manual before",
    "---",
    "**词汇扩展（AI）**",
    "old generated text",
    "---",
    "**Manual after**",
    "Keep this suffix exactly",
  ].join("\n");
  const middleUpdated = core.upsertVocabularyExpansionSection(generatedInMiddle, markdown);
  assert.equal(middleUpdated.endsWith("**Manual after**\nKeep this suffix exactly"), true);
  assert.equal(middleUpdated.includes("old generated text"), false);

  const preservedAfterAIDefinition = core.replacePrimaryDefinitionPreservingSections([
    "BASE_SENTINEL",
    "---",
    "**我的笔记**",
    "NOTE_SENTINEL",
    "---",
    "**词汇扩展（AI）**",
    "EXPANSION_SENTINEL",
    "---",
  ].join("\n"), "NEW_BASE");
  assert.equal(preservedAfterAIDefinition.includes("BASE_SENTINEL"), false);
  assert.equal(preservedAfterAIDefinition.startsWith("NEW_BASE"), true);
  assert.equal(preservedAfterAIDefinition.includes("NOTE_SENTINEL"), true, "AI definition must preserve manual sections");
  assert.equal(preservedAfterAIDefinition.includes("EXPANSION_SENTINEL"), true, "AI definition must preserve vocabulary expansion");
  assert.equal((preservedAfterAIDefinition.match(/\*\*词汇扩展（AI）\*\*/g) || []).length, 1);
  const expansionOnlyPreserved = core.replacePrimaryDefinitionPreservingSections(
    "**词汇扩展（AI）**\nEXPANSION_ONLY\n\n---",
    "GENERATED_BASE",
  );
  assert.equal(expansionOnlyPreserved.startsWith("GENERATED_BASE\n\n---\n**词汇扩展（AI）**"), true);
  assert.equal(expansionOnlyPreserved.includes("EXPANSION_ONLY"), true);

  const exactSuffix = "---\r\n**我的笔记**\r\nNOTE_WITH_TWO_SPACES  \r\n---\r\n**词汇扩展（AI）**\r\nEXPANSION_EXACT\r\n---";
  const compositeWithExactSuffix = `OLD_BASE\r\n\r\n${exactSuffix}`;
  assert.equal(core.extractPrimaryDefinition(compositeWithExactSuffix), "OLD_BASE");
  const primaryOnlyUpdated = core.replacePrimaryDefinitionPreservingSections(compositeWithExactSuffix, "NEW_PRIMARY");
  assert.equal(primaryOnlyUpdated.startsWith("NEW_PRIMARY\n\n---"), true);
  assert.equal(primaryOnlyUpdated.slice(primaryOnlyUpdated.indexOf("---")), exactSuffix, "manual and generated suffixes must remain byte-for-byte unchanged");
  assert.equal(core.extractPrimaryDefinition("**释义**\nexplicit primary\n---\n**我的笔记**\nkeep"), "explicit primary");
  assert.equal(core.extractPrimaryDefinition("**词汇扩展（AI）**\nonly expansion\n---"), "");
  const clearedPrimary = core.replacePrimaryDefinitionPreservingSections(compositeWithExactSuffix, "");
  assert.equal(clearedPrimary, exactSuffix, "clearing primary definition must preserve every following section");
  const restoredPrimary = core.replacePrimaryDefinitionPreservingSections(clearedPrimary, "RESTORED_PRIMARY");
  assert.equal(restoredPrimary.startsWith("RESTORED_PRIMARY\n\n---\r\n**我的笔记**"), true);
  assert.match(core.primaryDefinitionInputError("safe text\n---\nunsafe section"), /不能使用独立一行/);
  assert.match(core.primaryDefinitionInputError("**自定义标题**\ntext"), /首行不能只包含加粗标题/);
  assert.equal(core.primaryDefinitionInputError("ordinary **bold** text"), "");
  assert.equal(core.pointRectDistanceSquared(110, 120, { left: 100, right: 110, top: 100, bottom: 120 }), 0);
  assert.equal(core.pointRectDistanceSquared(116, 128, { left: 100, right: 110, top: 100, bottom: 120 }), 100, "corner retention must use Euclidean distance");

  const plugin = new PluginClass();
  plugin.state = core.defaultState();
  plugin.state.settings.vocabularyExpansionLimit = 2;
  plugin.currentAIConfig = async () => ({ maxTokens: 120, provider: "openai-compatible" });
  let observedPrompt = "";
  let observedConfig = null;
  plugin.requestAI = async (prompt, config) => {
    observedPrompt = prompt;
    observedConfig = config;
    return raw;
  };
  const generated = await plugin.generateVocabularyExpansion("aim", "We aim to improve.", "en");
  assert.equal(generated.wordFamily.length, 2);
  assert.match(observedPrompt, /We aim to improve\./);
  assert.match(observedPrompt, /最多 2 项/);
  assert.equal(observedConfig.maxTokens >= 900, true, "structured response needs a safe output budget");
  assert.equal(observedConfig.temperature, 0, "factual vocabulary relations should use deterministic sampling");
  assert.equal(observedConfig.retries, 0, "one expansion action must issue at most one billable model attempt");
  plugin.state.settings.aiEnabled = false;
  await assert.rejects(() => plugin.generateVocabularyExpansion("aim", "", "en"), /AI 尚未启用/);

  const defaults = core.defaultSettings();
  assert.equal(defaults.enableVocabularyExpansion, true);
  assert.equal(defaults.vocabularyExpansionLimit, 3);
  assert.match(defaults.vocabularyExpansionPrompt, /\{\{word\}\}/);
  assert.match(defaults.vocabularyExpansionPrompt, /\{\{max\}\}/);
  assert.match(defaults.vocabularyExpansionPrompt, /不得编造拼写/);
  const normalizedLegacyPrompt = core.normalizeState({
    settings: {
      vocabularyExpansionPrompt: defaults.vocabularyExpansionPrompt.replace(/\n6\.[\s\S]*$/u, ""),
    },
  });
  assert.match(normalizedLegacyPrompt.settings.vocabularyExpansionPrompt, /不得编造拼写/, "the previous untouched default prompt should migrate");

  const ordinarySiYuanModel = core.resolveSiYuanModelConfig(
    { id: "20260719172844-uzwvb3t", name: "some-real-api-model" },
    "https://example.com/v1",
  );
  assert.equal(ordinarySiYuanModel.model, "some-real-api-model", "the API model name must win over SiYuan's internal ID");
  assert.deepStrictEqual(ordinarySiYuanModel.extraParams, {});
  assert.equal(
    core.resolveSiYuanModelConfig({ id: "20260719172844-uzwvb3t", displayName: "Pretty label" }, "https://example.com/v1").model,
    "",
    "internal IDs and display labels must never be sent as provider model names",
  );
  const legacyDeepSeekChat = core.resolveSiYuanModelConfig(
    { id: "20260719172844-uzwvb3t", name: "deepseek-chat" },
    "https://api.deepseek.com",
  );
  assert.equal(legacyDeepSeekChat.model, "deepseek-v4-flash");
  assert.deepStrictEqual(legacyDeepSeekChat.extraParams, { thinking: { type: "disabled" } });
  const legacyDeepSeekReasoner = core.resolveSiYuanModelConfig(
    { id: "internal", name: "deepseek-reasoner" },
    "https://api.deepseek.com/",
  );
  assert.equal(legacyDeepSeekReasoner.model, "deepseek-v4-flash");
  assert.deepStrictEqual(legacyDeepSeekReasoner.extraParams, { thinking: { type: "enabled" } });
  assert.equal(
    core.resolveSiYuanModelConfig({ id: "internal", name: "deepseek-chat" }, "https://deepseek.example.com").model,
    "deepseek-chat",
    "legacy aliases must not be rewritten for third-party gateways",
  );
  const enabledProvider = { enabled: true, models: [
    { id: "first", name: "model-a", enabled: true },
    { id: "selected", name: "model-b", enabled: true },
  ] };
  assert.equal(core.selectSiYuanProviderModel([enabledProvider], "selected").model.name, "model-b");
  assert.equal(core.selectSiYuanProviderModel([enabledProvider], "model-a").model.name, "model-a");
  enabledProvider.models[0].displayName = "Friendly A";
  assert.equal(core.selectSiYuanProviderModel([enabledProvider], "Friendly A").model.name, "model-a");
  const priorityProvider = { enabled: true, models: [
    { id: "first-id", enabled: true, name: "real-id" },
    { id: "real-id", enabled: true, name: "second-model" },
  ] };
  assert.equal(
    core.selectSiYuanProviderModel([priorityProvider], "real-id").model.name,
    "second-model",
    "all IDs must be checked before any display-name or API-name fallback",
  );
  const ambiguousProvider = { enabled: true, models: [
    { id: "one", enabled: true, name: "model-one", displayName: "Same label" },
    { id: "two", enabled: true, name: "model-two", displayName: "Same label" },
  ] };
  assert.throws(() => core.selectSiYuanProviderModel([ambiguousProvider], "Same label"), /存在歧义/);
  assert.throws(
    () => core.selectSiYuanProviderModel([enabledProvider], "missing"),
    /已停用或不存在/,
    "a stale selected ID must not silently switch to another billable model",
  );
  assert.throws(
    () => core.selectSiYuanProviderModel([enabledProvider], ""),
    /多个 AI 模型/,
    "multiple enabled models require an explicit selection",
  );
  assert.equal(
    core.selectSiYuanProviderModel([{ enabled: true, models: [{ id: "only", name: "one", enabled: true }] }], "").model.name,
    "one",
  );

  const providerPlugin = new PluginClass();
  providerPlugin.state = core.defaultState();
  const originalFetch = global.fetch;
  const providerPayload = (protocol = "openai") => ({
    code: 0,
    data: { conf: { ai: {
      editing: { modelId: "editing-id" },
      agent: { modelId: "agent-id" },
      providers: [{
        enabled: true,
        protocol,
        baseURL: "https://example.com/v1",
        apiKey: "test-key",
        requestTimeout: 30,
        models: [
          { id: "agent-id", enabled: true, name: "agent-model" },
          { id: "editing-id", enabled: true, name: "editing-model" },
        ],
      }],
    } } },
  });
  try {
    global.fetch = async () => ({ json: async () => providerPayload() });
    const resolvedProvider = await providerPlugin.getSiYuanProvider({ forceRefresh: true });
    assert.equal(resolvedProvider.model, "editing-model", "vocabulary work should prefer SiYuan's editing model");
    global.fetch = async () => ({ json: async () => providerPayload("anthropic") });
    await assert.rejects(
      () => providerPlugin.getSiYuanProvider({ forceRefresh: true }),
      /暂不支持思源 AI 的“anthropic”协议/,
      "unsupported SiYuan protocols must fail explicitly instead of using the wrong wire format",
    );
  } finally {
    global.fetch = originalFetch;
  }

  process.stdout.write("PASS vocabulary expansion JSON validation, limits, formatting, idempotent merge and SiYuan AI compatibility\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
