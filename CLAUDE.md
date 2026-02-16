# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

300 Words Manager is a Chrome Extension (Manifest v3) that sends emails to preset contact lists via the Gmail API, with per-day duplicate prevention. Pure vanilla JavaScript with ES6 modules — no build tools, no npm dependencies, no framework.

## Development

Load unpacked at `chrome://extensions` with Developer mode enabled, pointed at the project root.

To package for distribution:
```
zip -r ../300_words_extension.zip manifest.json src/ icon*.png -x "*.git*" "scripts/*" "creds/*" "README.md"
```

There is no build step, test runner, or linter configured.

## Architecture

**Message-passing pattern**: Popup sends messages to the background service worker via `chrome.runtime.sendMessage()`, which handles all Gmail API calls.

```
popup.html/js  ──sendToList──►  background.js  ──► Gmail API
               ◄──response────
options.html/js ──────────────► chrome.storage.local
```

Key files:
- `manifest.json` — Extension config, OAuth2 scopes (`gmail.send`, `gmail.readonly`, `userinfo.email`), permissions (`storage`, `identity`)
- `src/background.js` — Service worker: OAuth token management, Gmail send/reply, duplicate checking, RFC 5322 email construction with base64url encoding
- `src/popup.js` — Popup UI: list selection, email composition, reply dialog when already sent today
- `src/options.js` — Settings: CRUD for contact lists with email validation
- `src/shared/storage.js` — Thin async wrapper around `chrome.storage.local` (`getLists()` / `saveLists()`)

## Storage Schema

All data lives in `chrome.storage.local`:
```js
{
  lists: [{ id: "timestamp", name: "string", emails: ["a@b.com"] }],
  userEmail: "cached-from-gmail-api"
}
```

## Key Behaviors

- Sending checks Gmail for emails already received today from the contact list before sending
- User's own email is automatically added to recipients
- Replies use proper threading headers (`In-Reply-To`, `References`)
- OAuth tokens are obtained via `chrome.identity.getAuthToken()`
