# Privacy Policy

This extension stores no user data on any external server.

- The only data stored by the extension is contact lists you create; these are stored locally in your browser using `chrome.storage.local` and remain on your device unless you delete them.
- OAuth access tokens are obtained and managed by the browser (Chrome Identity API) and are used only locally to call the Gmail REST API from the extension's service worker.
- Gmail permissions are used solely to:
  - Check whether a thread/message already exists for a given contact list,
  - Send a reply on your behalf or create a new message/thread when you instruct the extension to do so.
- The extension does not read or transmit your contact lists, emails, messages, or other personal data to any external servers under the developer's control.
- No analytics, telemetry, or third-party tracking is performed.

If you have questions about privacy or data handling, open an issue in the project or contact the developer listed in the Chrome Web Store listing.