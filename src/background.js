// Background service worker: checks whether a list has been sent today,
// records sends, and opens a compose window (mailto) as a basic send mechanism.

const CLIENT_ID = '732085666543-fb1akg7jl1e5hp5s3ook02p7n4vi4ioi.apps.googleusercontent.com';
const SCOPES = [
	'https://www.googleapis.com/auth/gmail.send',
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
const REDIRECT_URI = chrome.identity.getRedirectURL();
console.log('REDIRECT URI (add this to Google Cloud Console):', REDIRECT_URI);

function buildAuthUrl(opts = {}) {
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: 'token',
		scope: SCOPES,
	});
	if (opts.loginHint) params.set('login_hint', opts.loginHint);
	if (opts.prompt) params.set('prompt', opts.prompt);
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function parseTokenFromRedirect(redirectUrl) {
	const hash = new URL(redirectUrl).hash.substring(1);
	const params = new URLSearchParams(hash);
	const token = params.get('access_token');
	const expiresIn = parseInt(params.get('expires_in'), 10);
	if (!token) return null;
	return { token, expiresAt: Date.now() + expiresIn * 1000 };
}

// Get a valid token, refreshing silently if possible
async function getAccountToken() {
	// 1. Check stored token
	const stored = await chrome.storage.local.get(['authToken', 'authExpiresAt', 'accountEmail']);
	if (stored.authToken && stored.authExpiresAt && Date.now() < stored.authExpiresAt - 60000) {
		return stored.authToken;
	}

	// 2. Try silent refresh with login_hint
	if (stored.accountEmail) {
		try {
			const url = buildAuthUrl({ loginHint: stored.accountEmail });
			const redirectUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: false });
			const result = parseTokenFromRedirect(redirectUrl);
			if (result) {
				await chrome.storage.local.set({
					authToken: result.token,
					authExpiresAt: result.expiresAt,
				});
				return result.token;
			}
		} catch (e) {
			console.log('Silent refresh failed, will prompt user:', e.message);
		}
	}

	// 3. Interactive — shows account picker
	const url = buildAuthUrl({ prompt: stored.accountEmail ? undefined : 'select_account' });
	const redirectUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
	const result = parseTokenFromRedirect(redirectUrl);
	if (!result) throw new Error('Failed to get token from redirect');

	// Fetch account email for this token
	const email = await fetchEmailFromApi(result.token);
	await chrome.storage.local.set({
		authToken: result.token,
		authExpiresAt: result.expiresAt,
		accountEmail: email,
		userEmail: email,
	});
	return result.token;
}

async function fetchEmailFromApi(token) {
	const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!resp.ok) throw new Error(`Gmail API error: ${resp.status}`);
	const data = await resp.json();
	return data.emailAddress;
}

// Helper to get the authenticated user's email
async function getUserEmail(token) {
	const cached = await chrome.storage.local.get(['userEmail']);
	if (cached.userEmail) return cached.userEmail;

	const email = await fetchEmailFromApi(token);
	await chrome.storage.local.set({ userEmail: email });
	return email;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === 'sendToList') {
		console.log('sendToList received:', msg);
		const listId = msg.listId;
		const subject = msg.subject;
		const body = msg.body;
		
		chrome.storage.local.get(['lists'], res => {
			const lists = res.lists || [];
			const list = lists.find(l => l.id === listId);

			if (!list || !list.emails || list.emails.length === 0) {
				console.error('List not found or no emails');
				sendResponse({ error: 'No recipients found' });
				return;
			}

			// Check if we received an email from any contact in this list today
			getAccountToken().then(async (token) => {
				if (!token) {
					console.error('No token');
					sendResponse({ error: 'Auth failed' });
					return;
				}
				try {
					console.log('Checking if email received today...');
					const emailResult = await hasReceivedEmailToday(token, list.emails);
					if (emailResult.found) {
						console.log('Email found already sent, offering reply');
						sendResponse({ 
							alreadySent: true, 
							subject: emailResult.subject, 
							sender: emailResult.sender, 
							to: emailResult.to, 
							messageId: emailResult.messageId 
						});
						return;
					}
					// Send the email
					console.log('Sending email to list:', list.emails);
					const recipients = list.emails.join(',');
					await sendRawEmail(recipients, subject, body, token);
					console.log('Email sent successfully');
					sendResponse({ sent: true });
				} catch (err) {
					console.error('Error:', err);
					sendResponse({ error: err.message });
				}
			}).catch(err => {
				console.error('Auth error:', err);
				sendResponse({ error: 'Authentication failed' });
			});
		});

		// Return true to indicate we'll call sendResponse asynchronously.
		return true;
	}
});

async function base64UrlEncode(str) {
	return btoa(unescape(encodeURIComponent(str)))
		.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function hasReceivedEmailToday(token, contactEmails) {
	const today = new Date().toISOString().slice(0, 10);
	const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
	const query = `before:${tomorrow} after:${today}`;
	
	const resp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	
	if (!resp.ok) throw new Error('Failed to query Gmail');
	const data = await resp.json();
	const messages = data.messages || [];
	
	// Helper to extract emails from comma-separated list
	const extractEmails = (headerValue) => {
		return headerValue.split(',').map(part => {
			const match = part.match(/<(.+?)>/) || part.match(/([\w\.-]+@[\w\.-]+\.[\w]+)/);
			return match ? match[1].toLowerCase() : part.trim().toLowerCase();
		}).filter(e => e);
	};
	
	const contactEmailsLower = contactEmails.map(e => e.toLowerCase());
	const userEmail = (await getUserEmail(token)).toLowerCase();
	const allowedEmails = new Set([...contactEmailsLower, userEmail]);

	// Check each message: sender and ALL recipients must be in the list (+ user)
	for (const msg of messages) {
		const msgResp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!msgResp.ok) continue;
		const msgData = await msgResp.json();
		const headers = msgData.payload?.headers || [];
		const fromHeader = headers.find(h => h.name === 'From')?.value || '';
		const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
		const toHeader = headers.find(h => h.name === 'To')?.value || '';

		// Sender must be in list
		const senderEmail = extractEmails(fromHeader)[0];
		if (!contactEmailsLower.includes(senderEmail)) continue;

		// Every recipient must be in the list or the user
		const toEmails = extractEmails(toHeader);
		if (toEmails.length === 0) continue;
		const allRecipientsInList = toEmails.every(e => allowedEmails.has(e));
		if (!allRecipientsInList) continue;

		return {
			found: true,
			subject: subjectHeader,
			sender: fromHeader,
			to: toHeader,
			messageId: msg.id
		};
	}
	
	return { found: false };
}

async function sendRawEmail(recipientsCsv, subject, body, token) {
	if (!token) {
		token = await getAccountToken();
		if (!token) throw new Error('Auth failed');
	}
	
	// Get the authenticated user's email and add to recipients
	const userEmail = await getUserEmail(token);
	const recipients = recipientsCsv.split(',').map(e => e.trim());
	if (!recipients.includes(userEmail)) {
		recipients.push(userEmail);
	}
	const toHeader = recipients.join(', ');
	
	const msg =
		`To: ${toHeader}\r\n` +
		`Subject: ${subject}\r\n` +
		`Content-Type: text/plain; charset="UTF-8"\r\n` +
		`\r\n` +
		`${body}`;
	const raw = await base64UrlEncode(msg);
	const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ raw })
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(errText);
	}
	return resp.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === 'replyToEmail') {
		const messageId = msg.messageId;
		const replyBody = msg.replyBody;
		
		getAccountToken().then(async (token) => {
			if (!token) {
				sendResponse({ error: 'Auth failed' });
				return;
			}
			try {
				await replyToEmail(token, messageId, replyBody);
				sendResponse({ sent: true });
			} catch (err) {
				console.error('Reply failed:', err);
				sendResponse({ error: err.message });
			}
		}).catch(err => {
			console.error('Auth error:', err);
			sendResponse({ error: 'Authentication failed' });
		});
		
		return true;
	}
});

async function replyToEmail(token, messageId, replyBody) {
	// Fetch the original message to get headers and threadId (using format=full)
	const msgResp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!msgResp.ok) throw new Error('Failed to fetch original message');
	const msgData = await msgResp.json();
	const threadId = msgData.threadId; // Get actual thread ID
	const headers = msgData.payload?.headers || [];
	const hdr = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
	const fromHeader = hdr('From');
	const subjectHeader = hdr('Subject') || '(no subject)';
	const messageIdHeader = hdr('Message-ID');
	const referencesHeader = hdr('References');
	
	// Extract email from From header
	const emailMatch = fromHeader.match(/<(.+?)>/) || fromHeader.match(/([\w\.-]+@[\w\.-]+\.[\w]+)/);
	const replyTo = emailMatch ? emailMatch[1] : fromHeader;
	
	if (!replyTo) throw new Error('Could not extract sender email from message');
	
	// Get To header to reply to all recipients
	const toHeader = headers.find(h => h.name === 'To')?.value || '';
	
	// Build references list: existing references + message-id
	const inReplyTo = messageIdHeader || `<${messageId}@mail.gmail.com>`;
	const references = referencesHeader ? `${referencesHeader} ${inReplyTo}` : inReplyTo;
	
	// Build reply message with In-Reply-To and References headers (reply to all)
	const msg =
		`To: ${toHeader}\r\n` +
		`Subject: Re: ${subjectHeader}\r\n` +
		`In-Reply-To: ${inReplyTo}\r\n` +
		`References: ${references}\r\n` +
		`Content-Type: text/plain; charset="UTF-8"\r\n` +
		`\r\n` +
		`${replyBody}`;
	
	const raw = await base64UrlEncode(msg);
	const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ raw, threadId })
	});
	if (!sendResp.ok) {
		const errText = await sendResp.text();
		throw new Error(errText);
	}
	return sendResp.json();
}

// ── Account management messages (options page) ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === 'getAccount') {
		chrome.storage.local.get(['accountEmail'], res => {
			sendResponse({ email: res.accountEmail || null });
		});
		return true;
	}

	if (msg.action === 'switchAccount') {
		(async () => {
			// Clear stored auth so the next call is fully interactive
			await chrome.storage.local.remove(['authToken', 'authExpiresAt', 'accountEmail', 'userEmail']);
			try {
				const url = buildAuthUrl({ prompt: 'select_account' });
				const redirectUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
				const result = parseTokenFromRedirect(redirectUrl);
				if (!result) {
					sendResponse({ error: 'No token received' });
					return;
				}
				const email = await fetchEmailFromApi(result.token);
				await chrome.storage.local.set({
					authToken: result.token,
					authExpiresAt: result.expiresAt,
					accountEmail: email,
					userEmail: email,
				});
				sendResponse({ email });
			} catch (err) {
				console.error('switchAccount error:', err);
				sendResponse({ error: err.message });
			}
		})();
		return true;
	}
});