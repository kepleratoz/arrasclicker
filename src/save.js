import { state } from "./state.js";
import { isDebugUnlocked } from "./debug.js";

export const SAVE_KEY = "arrasclicker_save";
const SAVE_VERSION = 2;
const LEGACY_XOR_SEED = 695193841;

// ----- base64 (URL-safe, UTF-8) -----
function toBase64Utf8(str) {
	const bytes = new TextEncoder().encode(str);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Utf8(s) {
	let cleaned = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
	while (cleaned.length % 4) cleaned += "=";
	const bin = atob(cleaned);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

// Encode the current state. Wraps in a small envelope { v, t, state } so future
// migrations can branch on `v`. UTF-8-safe so any string in state survives.
// Runs the beforeSave hooks so a manual Save captures the same data autosave
// does (e.g. snapshotTanks turns live Tank instances into plain JSON).
export function encode() {
	for (const h of beforeSaveHooks) {
		try { h(); } catch (e) { console.error("beforeSave hook failed:", e); }
	}
	const payload = { v: SAVE_VERSION, t: Date.now(), state };
	return toBase64Utf8(JSON.stringify(payload));
}

// ----- merge -----
function isPlainObject(v) {
	return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
// Recursively merge `next` over `cur`. Plain objects merge key-by-key; arrays,
// primitives, and other typed values replace wholesale.
function deepMerge(cur, next) {
	if (next === undefined) return cur;
	if (isPlainObject(cur) && isPlainObject(next)) {
		const out = { ...cur };
		for (const k of Object.keys(next)) out[k] = deepMerge(cur[k], next[k]);
		return out;
	}
	return next;
}

// Pull a state-shaped object out of whatever the decoded payload happens to be:
// either the new {v, t, state} envelope or a bare state from older saves.
function extractState(payload) {
	if (payload && typeof payload === "object" && payload.state && typeof payload.state === "object") {
		return payload.state;
	}
	return payload;
}

// Apply the parsed state to the live state object via deepMerge. Only keys that
// already exist in `state` are copied — unknown keys from old/forged saves get
// ignored instead of polluting state.
function applyParsedState(parsed) {
	if (!isPlainObject(parsed)) throw new Error("Save root wasn't an object.");
	for (const key of Object.keys(parsed)) {
		if (!(key in state)) continue;
		state[key] = deepMerge(state[key], parsed[key]);
	}
}

// ----- legacy decoder (v1: XOR + btoa-of-string) -----
// Older saves used a byte-XOR cipher and btoa on the (potentially non-ASCII)
// JSON string. We keep this path so existing localStorage entries still load.
function legacyDecode(encoded) {
	let cleaned = String(encoded).replace(/\s+/g, "").replace(/ /g, "+");
	cleaned = cleaned.replace(/-/g, "+").replace(/_/g, "/");
	while (cleaned.length % 4) cleaned += "=";
	let raw;
	try { raw = atob(cleaned); } catch (e) { return null; }
	let seed = LEGACY_XOR_SEED;
	const out = new Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		seed ^= seed << 7;
		seed ^= seed >> 5;
		seed ^= seed << 11;
		out[i] = String.fromCharCode(raw.charCodeAt(i) ^ (seed & 255));
	}
	const json = out.join("");
	try { return JSON.parse(json); }
	catch (e) {
		// Legacy recovery: truncate to last `}` and retry.
		const last = json.lastIndexOf("}");
		if (last > 0) { try { return JSON.parse(json.slice(0, last + 1)); } catch (e2) {} }
		return null;
	}
}

// ----- decode + load -----
export function decode(encoded) {
	const input = String(encoded || "");
	if (!input.trim()) throw new Error("Save string is empty.");
	const errors = [];
	let parsed = null;
	// Path 1: new format — UTF-8 base64 → JSON.
	let utf8Json = null;
	try { utf8Json = fromBase64Utf8(input); }
	catch (e) { errors.push("new-format base64 decode failed: " + (e && e.message ? e.message : e)); }
	if (utf8Json !== null) {
		try { parsed = JSON.parse(utf8Json); }
		catch (e) {
			const last = utf8Json.lastIndexOf("}");
			if (last > 0) { try { parsed = JSON.parse(utf8Json.slice(0, last + 1)); } catch (e2) {} }
			if (!parsed) errors.push("new-format JSON parse failed: " + (e && e.message ? e.message : e));
		}
	}
	// Path 2: legacy XOR.
	if (!parsed || typeof parsed !== "object") {
		const legacy = legacyDecode(input);
		if (legacy && typeof legacy === "object") parsed = legacy;
		else errors.push("legacy XOR decode produced no usable object");
	}
	if (!parsed || typeof parsed !== "object") {
		console.warn("save.decode: input length", input.length, "preview", input.slice(0, 32));
		throw new Error("Save couldn't be decoded — " + (errors.join("; ") || "the data looks corrupted."));
	}
	applyParsedState(extractState(parsed));
}

// ----- storage / autosave / reset -----
let saveSuspended = false;
let autoSaveInterval = null;
const beforeUnloadHandler = () => saveToStorage();
const beforeSaveHooks = [];

export function onBeforeSave(fn) { beforeSaveHooks.push(fn); }

export function saveToStorage() {
	if (saveSuspended) return;
	// Debug-enabled (the "big" prompt) suppresses autosave so cheated state
	// doesn't accidentally overwrite the player's legit save. Manual Save via
	// the button still works since it calls encode()/clipboard directly.
	if (isDebugUnlocked()) return;
	try { localStorage.setItem(SAVE_KEY, encode()); }
	catch (e) { console.error("Save failed:", e); }
}

// Manual-load helper: validates the pasted/uploaded save string by running it
// through decode (which throws on garbage), writes the *raw* encoded string to
// localStorage under SAVE_KEY, and reloads. The reload means the next boot
// goes through the normal loadFromStorage path, so live game state (shapes,
// tanks, particles) gets rebuilt from scratch from a clean state object
// instead of mutating mid-session.
export function applyManualSave(text) {
	const cleaned = String(text || "").trim();
	if (!cleaned) throw new Error("Save string is empty.");
	// Throws if the string isn't decodeable. We discard the in-place mutation
	// it does — the reload below replays it from localStorage cleanly.
	decode(cleaned);
	try { localStorage.setItem(SAVE_KEY, cleaned); }
	catch (e) { throw new Error("Couldn't write the save to localStorage: " + (e && e.message ? e.message : e)); }
	// Suppress the autosave / beforeunload save fire-and-forget while we
	// reload, otherwise the current (about-to-be-replaced) state might
	// overwrite the freshly-stored save before the reload completes.
	saveSuspended = true;
	if (autoSaveInterval !== null) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
	window.removeEventListener("beforeunload", beforeUnloadHandler);
	location.reload();
}

// Trigger a browser download of the current save as a .txt file. Useful when
// the encoded string is too long to comfortably paste through prompt().
export function downloadSave(filename = "arrasclicker-save.txt") {
	const text = encode();
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	return text;
}

// Open a file picker and resolve with the file's text content. Cancel resolves
// with null so the caller can fall back to a paste-via-prompt flow.
export function pickSaveFile() {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "text/plain,.txt,.sav";
		input.style.display = "none";
		document.body.appendChild(input);
		let settled = false;
		input.onchange = async () => {
			if (settled) return;
			settled = true;
			const file = input.files && input.files[0];
			input.remove();
			if (!file) return resolve(null);
			try { resolve(await file.text()); }
			catch (e) { resolve(null); }
		};
		// If the user cancels the picker, `change` never fires; fall back on focus.
		const onFocus = () => {
			setTimeout(() => {
				if (settled) return;
				settled = true;
				input.remove();
				resolve(null);
			}, 300);
			window.removeEventListener("focus", onFocus);
		};
		window.addEventListener("focus", onFocus);
		input.click();
	});
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
	autoSaveInterval = setInterval(saveToStorage, 5 * 60 * 1000);
	window.addEventListener("beforeunload", beforeUnloadHandler);
}

export function resetGame() {
	saveSuspended = true;
	if (autoSaveInterval !== null) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
	window.removeEventListener("beforeunload", beforeUnloadHandler);
	try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
	location.reload();
}
