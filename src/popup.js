import { getLists } from './shared/storage.js';

async function init() {
	const select = document.getElementById('listSelect');
	const bodyInput = document.getElementById('body');
	const lists = await getLists();
	select.innerHTML = '<option value="">-- select a list --</option>';
	lists.forEach(l => {
		const o = document.createElement('option');
		o.value = l.id;
		o.textContent = l.name;
		select.appendChild(o);
	});

	document.getElementById('sendBtn').addEventListener('click', () => {
		const listId = select.value;
		const subject = document.getElementById('subject').value;
		const body = bodyInput.value;
		if (!listId) return alert('Please select a list');
		if (!subject) return alert('Please enter a subject');
		if (!body) return alert('Please enter a body');
		console.log('Sending message to background...');
		chrome.runtime.sendMessage({ action: 'sendToList', subject, body, listId }, resp => {
			console.log('Response received:', resp);
			if (resp && resp.alreadySent) {
                console.log('Email already received today:', resp);
                console.log('Email body being sent for reply:', body);
				showReplyDialog(resp, body);
			} else if (resp && resp.sent) {
				alert('Email sent successfully!');
				showFormView();
			} else if (resp && resp.error) {
				alert('Error: ' + resp.error);
			} else {
				alert('Error sending email.');
			}
		});
	});
}

function showFormView() {
	document.getElementById('formContainer').style.display = 'block';
	const dialog = document.getElementById('replyDialog');
	if (dialog) dialog.remove();
}

function showReplyDialog(emailData, body) {
	// Hide the form
	document.getElementById('formContainer').style.display = 'none';
	
	// Create styled dialog container
	const dialog = document.createElement('div');
	dialog.id = 'replyDialog';
	dialog.style.cssText = 'border: 1px solid #ddd; padding: 16px; background: white; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1)';
	
	const header = document.createElement('p');
	header.textContent = '✓ Email already received today';
	header.style.cssText = 'color: #27ae60; font-weight: 600; margin-bottom: 12px; font-size: 13px';
	dialog.appendChild(header);
	
	const subject = document.createElement('p');
	subject.innerHTML = `<strong>Subject:</strong> ${emailData.subject}`;
	subject.style.cssText = 'margin: 8px 0; font-size: 13px';
	dialog.appendChild(subject);
	
	const from = document.createElement('p');
	from.innerHTML = `<strong>From:</strong> ${emailData.sender}`;
	from.style.cssText = 'margin: 8px 0; font-size: 13px';
	dialog.appendChild(from);
	
	const to = document.createElement('p');
	to.innerHTML = `<strong>To:</strong> ${emailData.to}`;
	to.style.cssText = 'margin: 8px 0; font-size: 13px';
	dialog.appendChild(to);
	
	const replyLabel = document.createElement('p');
	replyLabel.textContent = 'Your reply:';
	replyLabel.style.cssText = 'margin: 12px 0 8px 0; color: #34495e; font-weight: 500; font-size: 13px';
	dialog.appendChild(replyLabel);
	
	const textarea = document.createElement('textarea');
	textarea.id = 'replyText';
	textarea.placeholder = 'Enter your reply message here...';
	textarea.value = body;
	textarea.style.cssText = 'width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 13px; height: 60px; resize: vertical';
	dialog.appendChild(textarea);
	
	const buttonContainer = document.createElement('div');
	buttonContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 12px';
	
	const confirmBtn = document.createElement('button');
	confirmBtn.textContent = '✓ Send Reply';
	confirmBtn.style.cssText = 'flex: 1; padding: 10px; border: none; border-radius: 6px; background: #27ae60; color: white; font-weight: 600; cursor: pointer; font-size: 13px';
	confirmBtn.addEventListener('click', () => sendReply(emailData.messageId, textarea.value));
	buttonContainer.appendChild(confirmBtn);
	
	const cancelBtn = document.createElement('button');
	cancelBtn.textContent = 'Cancel';
	cancelBtn.style.cssText = 'flex: 1; padding: 10px; border: none; border-radius: 6px; background: #95a5a6; color: white; font-weight: 600; cursor: pointer; font-size: 13px';
	cancelBtn.addEventListener('click', () => showFormView());
	buttonContainer.appendChild(cancelBtn);
	
	dialog.appendChild(buttonContainer);
	document.body.appendChild(dialog);
}

function sendReply(messageId, replyBody) {
	if (!replyBody.trim()) return alert('Please enter a reply');
	chrome.runtime.sendMessage({ action: 'replyToEmail', messageId, replyBody }, resp => {
		if (resp && resp.sent) {
			alert('Reply sent successfully!');
			showFormView();
		} else {
			alert('Error sending reply.');
		}
	});
}

document.addEventListener('DOMContentLoaded', init);
