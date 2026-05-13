import { state } from "./state.js";

const XOR_SEED = 695193841;

export function encode() {
	const chars = JSON.stringify(state).split("");
	let seed = XOR_SEED;
	for (let i = 0; i < chars.length; ++i) {
		seed ^= seed << 7;
		seed ^= seed >> 5;
		seed ^= seed << 11;
		chars[i] = String.fromCharCode(chars[i].charCodeAt(0) ^ (seed & 255));
	}
	return btoa(chars.join(""));
}

export function decode(encoded) {
	// Tolerate copy/paste damage: strip whitespace, restore `+` chars often replaced
	// by spaces in URL/text contexts, and re-pad the base64 string.
	let cleaned = String(encoded).replace(/\s+/g, "").replace(/ /g, "+");
	while (cleaned.length % 4) cleaned += "=";
	const chars = atob(cleaned).split("");
	let seed = XOR_SEED;
	for (let i = 0; i < chars.length; ++i) {
		seed ^= seed << 7;
		seed ^= seed >> 5;
		seed ^= seed << 11;
		chars[i] = String.fromCharCode(chars[i].charCodeAt(0) ^ (seed & 255));
	}
	const parsed = JSON.parse(chars.join(""));
	for (const key of Object.keys(parsed)) {
		if (key in state) state[key] = parsed[key];
	}
}

export const SAVE_KEY = "arrasclicker_save";

let saveSuspended = false;
let autoSaveInterval = null;
const beforeUnloadHandler = () => saveToStorage();
const beforeSaveHooks = [];
export function onBeforeSave(fn) { beforeSaveHooks.push(fn); }

export function saveToStorage() {
	if (saveSuspended) return;
	for (const h of beforeSaveHooks) try { h(); } catch (e) { console.error("beforeSave hook failed:", e); }
	try { localStorage.setItem(SAVE_KEY, encode()); }
	catch (e) { console.error("Save failed:", e); }
}

export function loadFromStorage() {
	try {
		const data = localStorage.getItem(SAVE_KEY);
		if (data) decode(data);
	} catch (e) {
		console.error("Load failed:", e);
	}
}

export function enableAutoSave() {
	if (autoSaveInterval !== null) return;
	autoSaveInterval = setInterval(saveToStorage, 5000);
	window.addEventListener("beforeunload", beforeUnloadHandler);
}

export function resetGame() {
	saveSuspended = true;
	if (autoSaveInterval !== null) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
	window.removeEventListener("beforeunload", beforeUnloadHandler);
	try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
	location.reload();
}
