// Minimal storage helpers (ES module) for popup/options
export async function getLists() {
	const res = await chrome.storage.local.get('lists');
	return res.lists || [];
}

export async function saveLists(lists) {
	await chrome.storage.local.set({ lists });
}
