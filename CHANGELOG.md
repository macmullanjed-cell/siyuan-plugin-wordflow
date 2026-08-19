# Changelog

## 0.6.7 - 2026-08-20

- Added a focused base-definition editor inside the desktop word window: expansion-only entries open it from the empty “释义” tab, while existing definitions expose an explicit edit action.
- Kept vocabulary expansion and other Markdown sections byte-for-byte intact when saving a base definition; the former all-section editor remains available as the clearly labelled “完整编辑” advanced path.
- Added a non-blocking 24 px pointer tolerance around hover windows and a smaller source-word corridor, while preserving delayed dismissal, immediate outside-click closing, and normal switching to other words.
- Made focused saves transactional in memory when persistence fails, retained failed drafts in the editor, skipped unchanged writes, and restored normal hover dismissal after editing.

## 0.6.6 - 2026-08-19

- Added in-SiYuan eight-way resizing for desktop word windows, with viewport clamping, stable manual positioning, explicit close behavior, and session-only size memory.
- Kept manually resized windows open for reading and in-window text selection/copy while preserving outside-click and Escape dismissal; narrow and coarse-pointer layouts continue to use the safe non-resizable card.
- Displayed base definitions and AI vocabulary expansion as concise independent tabs, including a UI-only empty definition state for expansion-only entries.
- Prevented AI definition regeneration from deleting manual sections or vocabulary expansion, including edits made while the request is in flight.
- Lightened the large popover surfaces while retaining the purple accent hierarchy and the existing dark theme.

## 0.6.5 - 2026-08-19

- Reworked AI vocabulary expansion into scannable category and word-entry cards instead of dense numbered lines.
- Separated each word's pronunciation and part of speech from its definition and relationship note, clarified the “形近 / 易混词” label, and added narrow-window styling.
- Ignore AI candidates that contain neither a meaning nor a relationship note, while preserving the three-per-category limit and generated-section replacement behavior.

## 0.6.4 - 2026-08-19

- Fixed non-working default shortcuts by migrating to new command identities and conflict-free `Ctrl+Alt+Shift+A/E` bindings; the old persisted `Ctrl+Alt+A/E` mappings are no longer registered.
- Kept “Add to vocabulary” available while selection translation is loading or has failed, and cancel the pending request when the add dialog opens.
- Added one-click AI vocabulary expansion for word-family members, synonyms, and confusable similar words, with strict JSON parsing, cross-category deduplication, and a hard maximum of three entries per category.
- Added an idempotent generated definition section that preserves manual notes, stale-response and concurrent-request guards, and a `Ctrl+Alt+Shift+E` command; documented the `Ctrl+Alt+Shift+A` selection-to-dialog command.
- Added configurable expansion prompting and result limits, narrow-dialog wrapping, privacy disclosure, and pure/real-DOM regression coverage.
- Fixed SiYuan AI model resolution so the editing model and provider-facing name are used instead of an internal ID; added scoped migration for retired DeepSeek aliases, preserved thinking-mode behavior, forced fresh connection-test configuration, rejected ambiguous/protocol-mismatched fallbacks, and limited each expansion action to one deterministic model attempt.
- Added a local-first Help and Feedback dialog in Settings and About, with session draft retention, explicit preview, copy fallback, and prefilled GitHub Issue Forms.
- Included only SiWords, SiYuan, and coarse Windows version details by default; theme and enabled-plugin names require explicit opt-in, and private document, vocabulary, and API data are excluded.
- Added long-report URL fallback, offline handling, narrow-window and dark-theme layouts, and regression coverage for privacy and popup timing.
- Added bilingual quick-start and feedback links, four GitHub Issue Forms, feedback label guidance, and expanded Bazaar search keywords.

## 0.6.3

- Fixed ordered and unordered list markers being clipped by SiYuan's global zero-padding list reset.
- Raised selector specificity only inside SiWords definition surfaces so heading sizes and spacing reliably apply in the real app.
- Added a local Windows system-font stack, balanced heading wrapping, tabular list markers, and calmer paragraph rhythm without changing colors.
- Added regression coverage for SiYuan's list reset, 320px layouts, and enlarged 20px text.

## 0.6.2

- Prevented long AI definitions, headings, phonetics, URLs, lists, and unbroken English tokens from being clipped in narrow cards and panels.
- Added bounded heading sizes and local horizontal scrolling for definition tables and code blocks.
- Improved 320–520px layouts for settings fields and grids without changing the existing color scheme.
- Added a narrow-panel CSS contract test and verified zero horizontal overflow at 320px and 360px.

## 0.6.1

- Added an amethyst purple visual system for definition, translation, editor, scope-picker, and vocabulary surfaces in light and dark themes.
- Made hover cards prefer placement below the matched word whenever at least 220px of readable space is available, while retaining stable above-placement near the viewport edge.
- Moved source metadata and mastery/edit actions into a compact anchored footer.
- Added accessible labels, high-contrast controls, viewport-aware height limits, and pure placement regression coverage.
- Updated the Bazaar preview image to match the new original purple interface.

## 0.6.0

- Prepared the first public GitHub and SiYuan Bazaar release.
- Added required marketplace icon, preview, bilingual documentation, privacy disclosure, license, and reproducible packaging.
- Limited the declared compatibility target to tested Windows desktop environments.
- Required HTTPS for public AI and custom TTS endpoints while keeping loopback HTTP support for local services.
- Redacted active API keys from surfaced AI request errors.
- Retained the 0.5.3 hover-card stability and performance improvements.

## 0.5.3

- Stabilized selection, hover hit testing, popover placement, and long-document performance.
- Added bounded caches and stale-request cancellation for AI and translation flows.
