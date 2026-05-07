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
	const chars = atob(encoded).split("");
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

const SAVE_KEY = "arrasclicker_save";

export function saveToStorage() {
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
