import { state, PER_MAP_FIELDS, freshMapState } from "./state.js";
import { game } from "./game.js";
import { syncTanks, snapshotTanks } from "./tank.js";
import { generalTab } from "./tabs.js";
import { Siege } from "./siege.js";

// Crash Zone (map idx 1) gets a fixed wall layout — a ring of half-walls and
// four corner blocks framing a central plaza. Coords are world-space, matching
// the exported tilemap format from the debug map editor (cellSize 140).
const CRASH_ZONE_WALL_HALF = 140;
// Crash Zone walls temporarily disabled. Re-add tuples like [x, y] (each a half
// wall snapped to the editor grid) to restore the ring.
const CRASH_ZONE_WALLS = [];

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

// Plain snapshot of a Siege — enough to reconstruct it on load. The pos is
// regenerated each frame from the room centre, so it's not stored. Bullets,
// gun states, etc. are transient and reset on construction.
function serializeSiege(s) {
	return { tier: s.tier, neutral: !!s.neutral, health: s.health };
}
function reconstructSiege(snap) {
	const s = new Siege(snap.tier ?? 1, { neutral: !!snap.neutral });
	if (snap.health != null) s.health = Math.min(snap.health, s.maxHealth);
	return s;
}

function snapshotCurrent() {
	snapshotTanks();
	const snap = {};
	for (const f of PER_MAP_FIELDS) snap[f] = state[f];
	snap.tanks = state.tanks;
	snap.sieges = game.sieges.map(serializeSiege);
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
	if (idx === 1) ensureCrashZoneSeeded();
}

// onBeforeSave hook — snapshots the *current* map's sieges into
// state.maps[currentMap].sieges so the next save captures them. Other maps'
// sieges were already snapshotted into state.maps[i].sieges when the player
// last switched away from that map.
export function snapshotSiegesForSave() {
	if (!state.maps) return;
	const snap = state.maps[state.currentMap] || (state.maps[state.currentMap] = {});
	snap.sieges = game.sieges.map(serializeSiege);
	// Also keep any other maps' sieges that we hadn't migrated yet — older
	// saves (pre-this-task) don't have the field at all.
	for (let i = 0; i < state.maps.length; i++) {
		if (i === state.currentMap) continue;
		const other = state.maps[i];
		if (other && !other.sieges && worlds[i] && Array.isArray(worlds[i].sieges)) {
			other.sieges = worlds[i].sieges.map(serializeSiege);
		}
	}
}

// Called after loadFromStorage — restores the current map's game.sieges and
// any other map's worlds[i].sieges from the saved snapshot.
export function restoreSiegesAfterLoad() {
	if (!state.maps) return;
	for (let i = 0; i < state.maps.length; i++) {
		const snap = state.maps[i];
		if (!snap || !Array.isArray(snap.sieges)) continue;
		const sieges = snap.sieges.map(reconstructSiege);
		if (i === state.currentMap) {
			game.sieges = sieges;
		} else {
			if (!worlds[i].sieges) Object.assign(worlds[i], freshWorld());
			worlds[i].sieges = sieges;
		}
	}
}

// Seed Crash Zone's fixed wall layout the first time we land on Map 1. The
// central neutral sanctuary itself is handled by the auto-spawn in main.js,
// which is unconditional on Map 2 (so the player can find and repair it).
// Idempotent: walls aren't duplicated on repeat calls.
export function ensureCrashZoneSeeded() {
	if (state.currentMap !== 1) return;
	for (const [wx, wy] of CRASH_ZONE_WALLS) {
		const dup = game.walls.some((w) => w.x === wx && w.y === wy && w.size === CRASH_ZONE_WALL_HALF);
		if (!dup) game.walls.push({ x: wx, y: wy, size: CRASH_ZONE_WALL_HALF });
	}
}
// Tracks Crash-Zone-specific spawning rules: the neutral sanctuary should always
// appear on Map 1 (so the user can repair it), regardless of Map 0 state.
export function shouldHaveNeutralSanctuary() {
	const hasRealHere = game.sieges.some((s) => !s.neutral);
	if (hasRealHere) return false;
	if (state.currentMap === 1) return true;            // Crash Zone always has one.
	return state.arenaFovUpgrades >= 1 && hasSanctuaryOnMap0();
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
