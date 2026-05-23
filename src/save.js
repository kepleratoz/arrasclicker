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

// Apply parsed state with shallow-merge for plain objects so older saves missing
// newly-added sub-keys (e.g. layersCaps[5..7], shapeEvoNerf[5..7]) keep their
// default sub-values instead of losing them entirely.
function applyParsedState(parsed) {
	for (const key of Object.keys(parsed)) {
		if (!(key in state)) continue;
		const cur = state[key];
		const next = parsed[key];
		const isPlainObj = (v) => v && typeof v === "object" && !Array.isArray(v);
		if (isPlainObj(cur) && isPlainObj(next)) {
			state[key] = { ...cur, ...next };
		} else {
			state[key] = next;
		}
	}
}

export function decode(encoded) {
	// Tolerate a variety of copy/paste damage modes:
	//  - whitespace anywhere,
	//  - `+` substituted with space (common when pasting from URLs / text fields),
	//  - URL-safe base64 (`-`/`_` instead of `+`/`/`),
	//  - missing `=` padding.
	let cleaned = String(encoded).replace(/\s+/g, "").replace(/ /g, "+");
	cleaned = cleaned.replace(/-/g, "+").replace(/_/g, "/");
	while (cleaned.length % 4) cleaned += "=";
	let raw;
	try {
		raw = atob(cleaned);
	} catch (e) {
		throw new Error("Save isn't valid base64 — copy/paste may have dropped characters.");
	}
	const chars = raw.split("");
	let seed = XOR_SEED;
	for (let i = 0; i < chars.length; ++i) {
		seed ^= seed << 7;
		seed ^= seed >> 5;
		seed ^= seed << 11;
		chars[i] = String.fromCharCode(chars[i].charCodeAt(0) ^ (seed & 255));
	}
	const decoded = chars.join("");
	let parsed = null;
	try {
		parsed = JSON.parse(decoded);
	} catch (e) {
		// Recovery attempt: a truncated save can still produce well-formed JSON if
		// we trim back to the last closing `}`. Useful when a paste was cut short.
		const lastBrace = decoded.lastIndexOf("}");
		if (lastBrace > 0) {
			try { parsed = JSON.parse(decoded.slice(0, lastBrace + 1)); } catch (e2) {}
		}
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Save couldn't be decoded — the data looks corrupted.");
	}
	applyParsedState(parsed);
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
