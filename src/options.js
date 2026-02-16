import { getLists, saveLists } from './shared/storage.js';

function renderLists(lists) {
	const container = document.getElementById('lists');
	container.innerHTML = '';
	if (lists.length === 0) {
		container.innerHTML = '<p style="color: #7f8c8d; font-size: 13px; text-align: center; padding: 20px">No contact lists yet. Create one above!</p>';
		return;
	}
	lists.forEach(l => {
		const div = document.createElement('div');
		div.className = 'list-item';
		
		const title = document.createElement('h4');
		title.textContent = l.name;
		div.appendChild(title);
		
		const emails = document.createElement('p');
		emails.textContent = l.emails.join(', ');
		div.appendChild(emails);
		
		const deleteBtn = document.createElement('button');
		deleteBtn.textContent = '✕ Delete';
		deleteBtn.addEventListener('click', async () => {
			if (confirm(`Delete list "${l.name}"?`)) {
				const updatedLists = lists.filter(item => item.id !== l.id);
				await saveLists(updatedLists);
				renderLists(updatedLists);
			}
		});
		div.appendChild(deleteBtn);
		
		container.appendChild(div);
	});
}

async function init() {
	const nameInput = document.getElementById('name');
	const emailsInput = document.getElementById('emails');
	const clearBtn = document.getElementById('clearBtn');
	const saveBtn = document.getElementById('saveBtn');

	let lists = await getLists();
	renderLists(lists);

	clearBtn.addEventListener('click', async () => {
		if (confirm('Are you sure you want to clear all lists?')) {
			await saveLists([]);
			renderLists([]);
		}
	});

	saveBtn.addEventListener('click', async () => {
		const name = nameInput.value.trim();
		const emails = emailsInput.value.split(',').map(s => s.trim()).filter(Boolean);
		if (!name || emails.length === 0) return alert('Provide a name and at least one email');
		
		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		const invalidEmails = emails.filter(e => !emailRegex.test(e));
		if (invalidEmails.length > 0) {
			return alert(`Invalid email(s): ${invalidEmails.join(', ')}`);
		}
		
		const id = String(Date.now());
		lists.push({ id, name, emails });
		await saveLists(lists);
		nameInput.value = '';
		emailsInput.value = '';
		renderLists(lists);
	});
}

document.addEventListener('DOMContentLoaded', init);
