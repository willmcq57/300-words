// Background service worker: checks whether a list has been sent today,
// records sends, and opens a compose window (mailto) as a basic send mechanism.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === 'sendToList') {
		const listId = msg.listId;
		const subject = msg.subject;
		const body = msg.body;
		
		chrome.storage.local.get(['lists'], res => {
			const lists = res.lists || [];
			const list = lists.find(l => l.id === listId);

			if (!list || !list.emails || list.emails.length === 0) {
				sendResponse({ error: 'No recipients found' });
				return;
			}

			// Check if we received an email from any contact in this list today
			chrome.identity.getAuthToken({ interactive: true }, async (token) => {
				if (!token) {
					sendResponse({ error: 'Auth failed' });
					return;
				}
				try {
					const emailResult = await hasReceivedEmailToday(token, list.emails);
					if (emailResult.found) {
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
					const recipients = list.emails.join(',');
					await sendRawEmail(recipients, subject, body, token);
					sendResponse({ sent: true });
				} catch (err) {
					console.error('Error:', err);
					sendResponse({ error: err.message });
				}
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
	
	// Check each message: sender must be in list AND all recipients must be in list
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
		
		// Check if all recipients are in the contact list
		const allRecipientsInList = toEmails.every(email => 
			contactEmailsLower.includes(email)
		);
		
		if (allRecipientsInList && toEmails.length > 0) {
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
		token = await new Promise((resolve, reject) => {
			chrome.identity.getAuthToken({ interactive: true }, (t) => {
				if (!t) reject(new Error('Auth failed'));
				else resolve(t);
			});
		});
	}
	const toHeader = recipientsCsv.split(',').map(e => e.trim()).join(', ');
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
		
		chrome.identity.getAuthToken({ interactive: true }, async (token) => {
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
	const threadId = msgData.threadId; // Get actual thread ID, not message ID
	const headers = msgData.payload?.headers || [];
	const fromHeader = headers.find(h => h.name === 'From')?.value || '';
	const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
	
	// Extract email from From header
	const emailMatch = fromHeader.match(/<(.+?)>/) || fromHeader.match(/([\w\.-]+@[\w\.-]+\.[\w]+)/);
	const replyTo = emailMatch ? emailMatch[1] : fromHeader;
	
	if (!replyTo) throw new Error('Could not extract sender email from message');
	
	// Get To header to reply to all recipients
	const toHeader = headers.find(h => h.name === 'To')?.value || '';
	
	// Build reply message with In-Reply-To and References headers (reply to all)
	const msg =
		`To: ${toHeader}\r\n` +
		`Subject: Re: ${subjectHeader}\r\n` +
		`In-Reply-To: <${messageId}@mail.gmail.com>\r\n` +
		`References: <${messageId}@mail.gmail.com>\r\n` +
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