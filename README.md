# SiWords 0.6.3

[简体中文](README.zh-CN.md)

SiWords is an independent vocabulary highlighting and review plugin for SiYuan. It supports quick word capture, in-document and text-layer PDF highlights, hover definitions, vocabulary books, pronunciation, resilient local storage, and optional AI-assisted definitions and translation.

SiWords is not affiliated with HiWords, Obsidian, or the SiYuan team.

## Features

- Add selected words and phrases from SiYuan documents or text-layer PDFs.
- Highlight active vocabulary with configurable styles and scopes.
- View definitions, source sentences, pronunciation, and mastery actions in a stable hover card.
- Organize entries into multiple vocabulary books with colors, aliases, archive state, and mastery state.
- Manage words in a dedicated library page and current-document sidebar.
- Import and export the complete vocabulary library as JSON.
- Recover from interrupted writes using pending-state recovery, rolling backups, recycle bin, and schema validation.
- Optionally generate contextual definitions or translations with a custom API or the AI provider configured in SiYuan.

## Compatibility

- SiYuan 3.7.0 or later
- Windows desktop frontend
- The 0.6.3 interface is Simplified Chinese; English marketplace metadata and documentation are provided
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

AI is disabled by default. A request is sent only after the user explicitly runs AI definition, selection translation, or connection testing. The selected word or text, source sentence, configured prompt, model identifier, and request parameters are sent to the endpoint selected by the user.

Custom TTS sends the requested word to the configured audio endpoint. System speech does not use the custom TTS endpoint.

Public endpoints must use HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1` so local model servers remain usable. See [PRIVACY.md](PRIVACY.md) before enabling network features.

## Data and backups

Vocabulary data is stored through the SiYuan plugin data API. API keys are stored separately from the vocabulary library and are excluded from vocabulary exports and rolling backups. They are still stored as local plugin data and are not protected by the operating-system credential vault.

Export a JSON backup before importing a large library or changing synchronization arrangements.

## Project relationship

The reading workflow was inspired by the open-source [HiWords](https://github.com/CatMuse/HiWords) plugin, which is distributed under the 0BSD license. SiWords is a separate implementation for SiYuan and does not copy Obsidian APIs, Canvas storage, branding, icons, or marketplace identity.

## License

SiWords is released under the [0BSD License](LICENSE).
