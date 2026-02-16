import { getLists, saveLists } from './shared/storage.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let lists = [];
let editingId = null;   // null = create mode, string = editing that list's id
let chips = [];         // emails currently in the chip input

// ── DOM refs ──
const nameInput     = document.getElementById('name');
const emailInput    = document.getElementById('emailInput');
const emailWrap     = document.getElementById('emailWrap');
const saveBtn       = document.getElementById('saveBtn');
const clearBtn      = document.getElementById('clearBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formSection   = document.getElementById('formSection');
const formHeading   = document.getElementById('formHeading');
const listsContainer = document.getElementById('lists');

// ── Chip helpers ──

function renderChips() {
	emailWrap.querySelectorAll('.chip').forEach(c => c.remove());
	chips.forEach((email, i) => {
		const chip = document.createElement('span');
		chip.className = 'chip';
		chip.innerHTML = `${email}<button class="remove" data-idx="${i}">&times;</button>`;
		emailWrap.insertBefore(chip, emailInput);
	});
}

function addChip(raw) {
	const email = raw.trim().toLowerCase();
	if (!email) return false;
	if (!EMAIL_RE.test(email)) {
		alert(`Invalid email: ${email}`);
		return false;
	}
	if (chips.includes(email)) {
		emailInput.value = '';
		return false;
	}
	chips.push(email);
	renderChips();
	emailInput.value = '';
	return true;
}

function removeChip(idx) {
	chips.splice(idx, 1);
	renderChips();
}

function setChips(emails) {
	chips = [...emails];
	renderChips();
}

// ── Chip input events ──

emailWrap.addEventListener('click', (e) => {
	if (e.target.classList.contains('remove')) {
		removeChip(Number(e.target.dataset.idx));
		return;
	}
	emailInput.focus();
});

emailInput.addEventListener('focus', () => emailWrap.classList.add('focused'));
emailInput.addEventListener('blur', () => {
	emailWrap.classList.remove('focused');
	// commit whatever is typed on blur
	if (emailInput.value.trim()) addChip(emailInput.value);
});

emailInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' || e.key === ',') {
		e.preventDefault();
		addChip(emailInput.value);
	}
	if (e.key === 'Backspace' && emailInput.value === '' && chips.length) {
		removeChip(chips.length - 1);
	}
});

// Also handle pasting a comma-separated list
emailInput.addEventListener('paste', (e) => {
	const text = (e.clipboardData || window.clipboardData).getData('text');
	if (text.includes(',') || text.includes('\n')) {
		e.preventDefault();
		text.split(/[,\n]+/).forEach(s => addChip(s));
	}
});

// ── Edit mode toggle ──

function enterEditMode(list) {
	editingId = list.id;
	nameInput.value = list.name;
	setChips(list.emails);
	formHeading.textContent = 'Edit List';
	saveBtn.textContent = 'Update List';
	cancelEditBtn.style.display = 'inline-block';
	formSection.classList.add('editing');
	nameInput.focus();
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitEditMode() {
	editingId = null;
	nameInput.value = '';
	emailInput.value = '';
	setChips([]);
	formHeading.textContent = 'Create New List';
	saveBtn.textContent = 'Save List';
	cancelEditBtn.style.display = 'none';
	formSection.classList.remove('editing');
}

cancelEditBtn.addEventListener('click', exitEditMode);

// ── Render list cards ──

function renderLists() {
	listsContainer.innerHTML = '';
	if (lists.length === 0) {
		listsContainer.innerHTML = '<p class="empty-state">No contact lists yet. Create one above!</p>';
		return;
	}
	lists.forEach(l => {
		const div = document.createElement('div');
		div.className = 'list-item';

		// header row: name + action buttons
		const header = document.createElement('div');
		header.className = 'list-header';

		const title = document.createElement('h4');
		title.textContent = l.name;
		header.appendChild(title);

		const actions = document.createElement('div');
		actions.className = 'list-actions';

		const editBtn = document.createElement('button');
		editBtn.textContent = 'Edit';
		editBtn.className = 'btn-edit';
		editBtn.addEventListener('click', () => enterEditMode(l));
		actions.appendChild(editBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.textContent = 'Delete';
		deleteBtn.className = 'btn-delete';
		deleteBtn.addEventListener('click', async () => {
			if (!confirm(`Delete list "${l.name}"?`)) return;
			lists = lists.filter(item => item.id !== l.id);
			await saveLists(lists);
			if (editingId === l.id) exitEditMode();
			renderLists();
		});
		actions.appendChild(deleteBtn);
		header.appendChild(actions);
		div.appendChild(header);

		// email tags
		const emailsDiv = document.createElement('div');
		emailsDiv.className = 'list-emails';
		l.emails.forEach(email => {
			const tag = document.createElement('span');
			tag.className = 'email-tag';
			tag.textContent = email;
			emailsDiv.appendChild(tag);
		});
		div.appendChild(emailsDiv);

		listsContainer.appendChild(div);
	});
}

// ── Save / update ──

saveBtn.addEventListener('click', async () => {
	// commit anything still typed in the input
	if (emailInput.value.trim()) addChip(emailInput.value);

	const name = nameInput.value.trim();
	if (!name || chips.length === 0) return alert('Provide a name and at least one email.');

	if (editingId) {
		const list = lists.find(l => l.id === editingId);
		if (list) {
			list.name = name;
			list.emails = [...chips];
		}
	} else {
		lists.push({ id: String(Date.now()), name, emails: [...chips] });
	}

	await saveLists(lists);
	exitEditMode();
	renderLists();
});

// ── Clear all ──

clearBtn.addEventListener('click', async () => {
	if (!confirm('Are you sure you want to clear all lists?')) return;
	lists = [];
	await saveLists(lists);
	exitEditMode();
	renderLists();
});

// ── Account ──

const accountEmailEl = document.getElementById('accountEmail');
const switchAccountBtn = document.getElementById('switchAccountBtn');

function showAccountEmail(email) {
	accountEmailEl.textContent = email || 'Not signed in';
}

function loadAccount() {
	chrome.runtime.sendMessage({ action: 'getAccount' }, resp => {
		showAccountEmail(resp?.email);
	});
}

switchAccountBtn.addEventListener('click', () => {
	accountEmailEl.textContent = 'Switching...';
	switchAccountBtn.disabled = true;
	chrome.runtime.sendMessage({ action: 'switchAccount' }, resp => {
		switchAccountBtn.disabled = false;
		if (resp?.email) {
			showAccountEmail(resp.email);
		} else {
			showAccountEmail(null);
			if (resp?.error) alert('Switch failed: ' + resp.error);
		}
	});
});

// ── Init ──

async function init() {
	lists = await getLists();
	renderLists();
	loadAccount();
}

document.addEventListener('DOMContentLoaded', init);
