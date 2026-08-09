# Privacy and network disclosure

SiWords has no analytics, advertising, telemetry, or developer-operated server.

## Local data

The vocabulary library, settings, rolling backups, pending-write recovery data, and recycle bin are stored through the SiYuan plugin data API. A custom AI API key is stored in a separate plugin data file. It is excluded from vocabulary JSON exports and rolling vocabulary backups, but it is not protected by the operating-system credential vault.

## Network requests

SiWords performs no AI request merely because a document is opened or highlighted. Network access occurs only after a user explicitly triggers one of the following actions:

- AI definition generation
- selection translation
- AI connection testing
- custom URL pronunciation

AI requests may contain the selected word or text, the source sentence or surrounding context, the configured prompt, model identifier, and additional request parameters. These are sent directly to the endpoint selected by the user. The API key is sent to that provider using the protocol required by the selected provider.

When “Use current SiYuan AI” is selected, SiWords reads the enabled provider configuration from SiYuan on demand and keeps a short-lived in-memory cache. It does not include that key in vocabulary export or backup files.

Custom URL pronunciation sends the requested word to the configured TTS endpoint. Browser/system speech does not use that endpoint.

## Transport security

Public AI and TTS endpoints must use HTTPS. Plain HTTP is accepted only for loopback hosts (`localhost`, `127.0.0.1`, and `::1`) to support local model and speech servers. Error messages are redacted if they contain the active API key.

## Data deletion

Deleting or uninstalling the plugin may be separate from deleting its plugin data, depending on the SiYuan version and uninstall choice. Before removal, export the vocabulary library if it should be retained. Remove the SiWords plugin data files from the workspace only after making a backup.
