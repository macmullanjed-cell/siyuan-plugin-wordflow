# Changelog

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
