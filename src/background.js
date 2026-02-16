// Background service worker: checks whether a list has been sent today,
// records sends, and opens a compose window (mailto) as a basic send mechanism.

// Helper to get auth token
async function getAccountToken() {
	return new Promise(resolve => {
		chrome.identity.getAuthToken({ interactive: true }, token => {
			resolve(token);
		});
	});
}

// Helper to get the authenticated user's email
async function getUserEmail(token) {
	try {
		// Check cache first
		const cached = await new Promise(resolve => {
			chrome.storage.local.get(['userEmail'], res => resolve(res.userEmail));
		});
		if (cached) {
			console.log('getUserEmail: returning cached:', cached);
			return cached;
		}
		
		console.log('getUserEmail: fetching from Gmail API');
		// Fetch from Gmail API
		const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!resp.ok) throw new Error(`Gmail API error: ${resp.status} ${resp.statusText}`);
		const data = await resp.json();
		const email = data.emailAddress;
		
		console.log('getUserEmail: got email from API:', email);
		// Cache it
		chrome.storage.local.set({ userEmail: email });
		return email;
	} catch (err) {
		console.error('getUserEmail error:', err);
		throw err;
	}
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
	const userEmail = await getUserEmail(token);
	
	// Check each message: sender must be in list AND user must be in recipients
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
		
		// Extract sender email
		const senderEmails = extractEmails(fromHeader);
		const senderEmail = senderEmails[0];
		
		// Check if sender is in contact list
		if (!contactEmailsLower.includes(senderEmail)) continue;
		
		// Extract all recipients from To header
		const toEmails = extractEmails(toHeader);
		
		// Check if user is one of the recipients
		const userIsRecipient = toEmails.includes(userEmail.toLowerCase());
		
		if (userIsRecipient && toEmails.length > 0) {
			return {
				found: true,
				subject: subjectHeader,
				sender: fromHeader,
				to: toHeader,
				messageId: msg.id
			};
		}
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
	const fromHeader = headers.find(h => h.name === 'From')?.value || '';
	const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
	const messageIdHeader = headers.find(h => h.name === 'Message-ID')?.value || '';
	const referencesHeader = headers.find(h => h.name === 'References')?.value || '';
	
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