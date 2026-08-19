# SiWords 0.6.7

[简体中文](README.zh-CN.md)

[Quick start](#quick-start) · [Report an issue](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new/choose) · [Request a feature](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=feature.yml) · [Changelog](CHANGELOG.md)

**Collect unfamiliar words while reading SiYuan documents or text-layer PDFs, then notice and review them when they appear again.**

SiWords is an independent vocabulary highlighting and review plugin for SiYuan. Its core workflow is “capture a selection → highlight later occurrences → review the definition and source on hover → mark it mastered.” It also provides multiple vocabulary books, pronunciation, resilient local storage, and optional AI-assisted definitions and translation.

The primary supported environment is currently the **Windows desktop frontend**. PDFs must contain a selectable text layer.

SiWords is not affiliated with HiWords, Obsidian, or the SiYuan team.

## Quick start

1. Install and enable SiWords from the SiYuan Bazaar.
2. Select a word or phrase in a SiYuan document or text-layer PDF, then press `Ctrl+Alt+Shift+A` to open the add-word dialog. The selection button and context menu remain available.
3. When the entry appears again within the enabled scope, it is highlighted according to your settings. Hover steadily to review its definition, source sentence, origin, and mastery action.
4. Organize entries in the dedicated library page or current-document sidebar. AI never runs merely because text is selected or a document is opened; it runs only after an explicit button or AI command.

## Features

- Add selected words and phrases from SiYuan documents or text-layer PDFs.
- Highlight active vocabulary with configurable styles and scopes.
- View definitions, source sentences, pronunciation, and mastery actions in a stable hover card.
- Edit only the base definition inside the word window; vocabulary expansion and other Markdown sections remain unchanged, while **完整编辑** keeps the advanced all-section editor available.
- A non-blocking pointer tolerance around the window prevents accidental dismissal near its edge; moving away still closes it automatically and outside clicks still close immediately.
- Resize the Windows desktop word window from any edge or corner; a manually sized window stays open, allows text selection and copying inside the window, and reuses that size for the current SiYuan session.
- Organize entries into multiple vocabulary books with colors, aliases, archive state, and mastery state.
- Manage words in a dedicated library page and current-document sidebar.
- Import and export the complete vocabulary library as JSON.
- Recover from interrupted writes using pending-state recovery, rolling backups, recycle bin, and schema validation.
- Optionally generate contextual definitions, translations, and structured word-family, near-synonym, and spelling/usage-confusable expansions with a custom API or the AI provider configured in SiYuan.
- Vocabulary expansion is locally deduplicated, capped at three entries per category, and rendered as scannable “entry heading + meaning + relationship/difference” cards in a fixed Markdown section. Re-running it replaces only that generated section and preserves other manual sections.
- Definitions and vocabulary expansion use separate tabs when both exist. Expansion-only entries get a UI-only empty definition state, and regenerating an AI definition preserves manual sections and the latest expansion edits.
- When SiYuan AI settings are used, the plugin prefers SiYuan's editing model and resolves the provider-facing model name rather than an internal ID. Retired DeepSeek aliases are migrated only for the official DeepSeek endpoint. Automatic SiYuan-provider loading currently supports the OpenAI protocol and reports other protocols explicitly; updating the model name in SiYuan itself is still recommended.

## Shortcuts

- `Ctrl+Alt+Shift+A`: open the add-word dialog with the current selection and source sentence; it does not save automatically.
- `Ctrl+Alt+Shift+E`: enrich the word in the current add/edit dialog; it does not save automatically.

Version 0.6.4 uses new command identities and three-modifier defaults so persisted pre-0.6.4 `Ctrl+Alt+A/E` conflicts cannot override the fix. Search for `SiWords` under **SiYuan Settings → Keymap** to rebind them if needed.

## Compatibility

- SiYuan 3.7.0 or later
- Windows desktop frontend
- The 0.6.7 interface is Simplified Chinese; English marketplace metadata and documentation are provided
- PDFs must contain a selectable text layer; scanned PDFs require OCR first

The first public release deliberately does not claim support for macOS, Linux, mobile, browser frontend, Canvas, or automatic conflict merging between concurrently edited devices.

## Installation

### SiYuan Bazaar

After the plugin is accepted into the community Bazaar, open **Bazaar → Plugins**, search for **SiWords**, install it, and enable it.

### Manual installation

1. Download `package.zip` from the latest GitHub Release.
2. Extract it to `{SiYuan workspace}/data/plugins/siyuan-plugin-wordflow/`.
3. Restart SiYuan, then enable SiWords in the downloaded plugins list.

## AI and network access

AI does not send requests automatically. A request is sent only after the user explicitly runs AI definition, AI vocabulary expansion, selection translation, connection testing, or the corresponding AI shortcut. The selected word or text, source sentence, configured prompt, model identifier, and request parameters are sent to the endpoint selected by the user. AI-generated etymological and semantic relationships can be wrong and must be reviewed before saving.

Custom TTS sends the requested word to the configured audio endpoint. System speech does not use the custom TTS endpoint.

Public endpoints must use HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1` so local model servers remain usable. See [PRIVACY.md](PRIVACY.md) before enabling network features.

## Data and backups

Vocabulary data is stored through the SiYuan plugin data API. API keys are stored separately from the vocabulary library and are excluded from vocabulary exports and rolling backups. They are still stored as local plugin data and are not protected by the operating-system credential vault.

Export a JSON backup before importing a large library or changing synchronization arrangements.

## Help and feedback

- [Report a functional problem](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=bug.yml)
- [Report a slowdown or performance problem](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=performance.yml)
- [Report a SiYuan version, theme, or environment compatibility problem](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=compatibility.yml)
- [Request a feature](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=feature.yml)

When reporting a problem, include the SiWords, SiYuan, and Windows versions, whether it occurred in a document or PDF, reproduction steps, and a screenshot with private content removed. GitHub Issues are public. Never paste API keys, passwords, access tokens, private document text, a complete vocabulary library, or other sensitive information.

These feedback links do not automatically read or upload SiYuan documents, PDFs, vocabulary data, source sentences, API settings, or enabled-plugin lists. You review and choose every piece of text and every attachment before submitting it to GitHub.

## Project relationship

The reading workflow was inspired by the open-source [HiWords](https://github.com/CatMuse/HiWords) plugin, which is distributed under the 0BSD license. SiWords is a separate implementation for SiYuan and does not copy Obsidian APIs, Canvas storage, branding, icons, or marketplace identity.

## License

SiWords is released under the [0BSD License](LICENSE).
