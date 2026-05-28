export function formatNumber(n) {
	if (n >= 1e15) return n.toExponential(3).replace("+", "");
	const intPart = Math.trunc(n);
	const frac = n - intPart;
	if (n >= 1000) {
		const intStr = intPart.toLocaleString("en-US");
		if (Number.isInteger(n)) return intStr;
		return intStr + (Math.round(frac * 100) / 100 + "").slice(1);
	}
	const fracStr = (Math.round(frac * 100) / 100 + "").slice(1);
	return intPart + fracStr;
}

export class Vec2 {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
	static circle(angle, radius = 1) {
		return new Vec2(Math.cos(angle) * radius, Math.sin(angle) * radius);
	}
	add(v) { this.x += v.x; this.y += v.y; }
	sub(v) { this.x -= v.x; this.y -= v.y; }
	addVal(s) { this.x += s; this.y += s; }
	mulVal(s) { this.x *= s; this.y *= s; }
	divideVal(s) { this.x /= s; this.y /= s; return this; }
	length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
	clone() { return new Vec2(this.x, this.y); }
}

// Linearly interpolate between two #rrggbb colors. t is clamped to [0,1].
export function lerpColor(a, b, t) {
	const tt = Math.max(0, Math.min(1, t));
	const ar = parseInt(a.slice(1, 3), 16);
	const ag = parseInt(a.slice(3, 5), 16);
	const ab = parseInt(a.slice(5, 7), 16);
	const br = parseInt(b.slice(1, 3), 16);
	const bg = parseInt(b.slice(3, 5), 16);
	const bb = parseInt(b.slice(5, 7), 16);
	const r = Math.round(ar + (br - ar) * tt);
	const g = Math.round(ag + (bg - ag) * tt);
	const bl = Math.round(ab + (bb - ab) * tt);
	return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + bl.toString(16).padStart(2, "0");
}

// Per-frame regen amount, tuned to ~0.5 HP/sec at 60fps.
export const REGEN_PER_FRAME = 0.5 / 60;

// OSA's skill-to-stat conversion: a logarithmic curve normalized by the cap, then
// passed through a linear/inverse `apply` function. See server/game/entities/skills.js.
//   curve:  log(4·level/cap + 1) / 1.6   →  ranges roughly 0 (no upgrade) to ~1.006 (max).
//   apply:  for non-negative attrib, returns f·attrib + 1.
//           for negative attrib (used for inverse curves), returns 1/(1 - attrib·f).
// Together they make most upgrades scale ~1× → (f+1)× from no-upgrade to max.
export function osaCurve(level, cap) {
	if (cap <= 0 || level <= 0) return 0;
	return Math.log(4 * level / cap + 1) / 1.6;
}
export function osaApply(f, x) {
	return x < 0 ? 1 / (1 - x * f) : f * x + 1;
}

const darkenCache = new Map();
const clamp255 = (n) => Math.max(0, Math.min(255, n));
export function darken(hex, brightness = 0.6) {
	const key = hex + brightness;
	const cached = darkenCache.get(key);
	if (cached) return cached;
	// Channels are clamped to 0..255 — brightness > 1 (used by gem shading)
	// otherwise overflows past 255 → "#1aafff" becomes 3-hex digits → invalid
	// color → ctx.fillStyle silently falls back to whatever was set previously
	// (which is how the gem looked like it "stole" colors from nearby shapes).
	const r = clamp255(Math.round(parseInt(hex.slice(1, 3), 16) * brightness + 34 * (1 - brightness)));
	const g = clamp255(Math.round(parseInt(hex.slice(3, 5), 16) * brightness + 34 * (1 - brightness)));
	const b = clamp255(Math.round(parseInt(hex.slice(5, 7), 16) * brightness + 34 * (1 - brightness)));
	const alpha = hex.length > 7 ? hex.slice(7, 9) : "";
	const result =
		"#" +
		r.toString(16).padStart(2, "0") +
		g.toString(16).padStart(2, "0") +
		b.toString(16).padStart(2, "0") +
		alpha;
	darkenCache.set(key, result);
	return result;
}

// HSL → #rrggbb. h in degrees, s/l in 0..1. Used by gem rendering to feed
// rainbow rarity colors through darken() (which only accepts hex).
export function hslToHex(h, s, l) {
	h = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0, g = 0, b = 0;
	if (h < 60)       { r = c; g = x; }
	else if (h < 120) { r = x; g = c; }
	else if (h < 180) {        g = c; b = x; }
	else if (h < 240) {        g = x; b = c; }
	else if (h < 300) { r = x;        b = c; }
	else              { r = c;        b = x; }
	const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
	return "#" + toHex(r) + toHex(g) + toHex(b);
}

export const colors = {
	blue: "#3ca4cb",
	darkArena: "#a4a4ad",
	egg: "#e8ebf7",
	square: "#efc74b",
	triangle: "#e7896d",
	pentagon: "#8d6adf",
	hexagon: "#7adbba",
	heptagon: "#8abc3f",
	octagon: "#cc669c",
	nonagon: "#dbdbdb",
	shiny: "#b9e87e",
	legendary: "#7ad3db",
	shadow: "#22222220",
	ultra: "#ff4f5d",
};
