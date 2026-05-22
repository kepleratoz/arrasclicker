import { state, PER_MAP_FIELDS, freshMapState } from "./state.js";
import { game } from "./game.js";
import { syncTanks, snapshotTanks } from "./tank.js";
import { generalTab } from "./tabs.js";

// Live (non-serializable) per-map containers. Maps share `state.maps[i]` for plain
// upgrade snapshots; live game objects (shapes/walls/etc.) sit here so save/load
// stays simple and ephemeral entities don't try to round-trip through JSON.
const worlds = [
	{ shapes: null, sieges: null, walls: null, particles: null, flyingText: null, goldEffects: null, lightningBolts: null },
	{ shapes: null, sieges: null, walls: null, particles: null, flyingText: null, goldEffects: null, lightningBolts: null },
];
const WORLD_KEYS = ["shapes", "sieges", "walls", "particles", "flyingText", "goldEffects", "lightningBolts"];

function freshWorld() {
	return { shapes: [], sieges: [], walls: [], particles: [], flyingText: [], goldEffects: [], lightningBolts: [] };
}

function snapshotCurrent() {
	snapshotTanks();
	const snap = {};
	for (const f of PER_MAP_FIELDS) snap[f] = state[f];
	snap.tanks = state.tanks;
	state.maps[state.currentMap] = snap;
	// World references — kept off `state` so they don't go through JSON.stringify.
	const w = worlds[state.currentMap];
	for (const k of WORLD_KEYS) w[k] = game[k];
}

function applyMap(idx) {
	const snap = state.maps[idx] || freshMapState();
	for (const f of PER_MAP_FIELDS) state[f] = snap[f];
	state.tanks = snap.tanks || [];
	let w = worlds[idx];
	if (!w.shapes) Object.assign(w, freshWorld());
	for (const k of WORLD_KEYS) game[k] = w[k];
	game.tanks = [];
	syncTanks();
}

export function switchToMap(idx) {
	if (idx === state.currentMap) return;
	if (idx < 0 || idx > 1) return;
	if (idx === 1 && !state.map1Unlocked) return;
	snapshotCurrent();
	applyMap(idx);
	state.currentMap = idx;
	// Tabs gated by per-map unlocks (squaresUnlocked, etc.) may hide the active tab.
	game.currentTab = generalTab;
}

// True if Map 1 (currentMap 0) has at least one non-neutral sanctuary placed —
// works whether we're currently on Map 1 or Map 2 by peeking at the saved world.
export function hasSanctuaryOnMap0() {
	const sieges = state.currentMap === 0 ? game.sieges : (worlds[0].sieges || []);
	return sieges.some((s) => !s.neutral);
}

export function tanksAllMaxed() {
	if (state.tankCount < 3) return false;
	if (game.tanks.length < 3) return false;
	for (const t of game.tanks) {
		if (!t || t.level < 42) return false;
	}
	return true;
}

export function checkMap1Unlock() {
	if (state.map1Unlocked) return;
	if (state.currentMap !== 0) return;
	if (state.score < 1e19) return;
	if (!tanksAllMaxed()) return;
	if (!(state.lightningOwned || state.poisonOwned || state.midasOwned)) return;
	state.map1Unlocked = true;
}
