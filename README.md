# 300 Words Manager — Chrome Extension (scaffold)

This repository contains a minimal scaffold for an email-manager Chrome extension.

Features included in the scaffold:
- Popup UI to select a contact list and trigger a send
- Options page to create / edit contact lists
- Background service worker that checks "sent today" and opens a mail compose (mailto)
- Storage helpers using `chrome.storage.local`

Next steps you might implement:
- Integrate Gmail API with OAuth for programmatic sends
- Add templating, scheduling, batching, and rate limits
- Add tests and build tooling if you compile assets

To load the extension for development:
1. Open `chrome://extensions` in Chrome
2. Enable Developer mode
3. Click "Load unpacked" and select this project folder


To zip:
`zip -r ../300_words_extension.zip manifest.json src/ icon*.png -x "*.git*" "scripts/*" "creds/*" "README.md"`