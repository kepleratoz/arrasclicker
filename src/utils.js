export function formatNumber(n) {
	if (n >= 1e6) return n.toExponential(3).replace("+", "");
	if (n >= 1000 && Number.isInteger(n)) {
		const s = n + "";
		const len = s.length;
		return s.slice(0, len - 3) + "," + s.slice(len - 3, len);
	}
	const intPart = Math.trunc(n);
	const frac = n - intPart;
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

const darkenCache = new Map();
export function darken(hex, brightness = 0.6) {
	const key = hex + brightness;
	const cached = darkenCache.get(key);
	if (cached) return cached;
	const r = Math.round(parseInt(hex.slice(1, 3), 16) * brightness + 34 * (1 - brightness));
	const g = Math.round(parseInt(hex.slice(3, 5), 16) * brightness + 34 * (1 - brightness));
	const b = Math.round(parseInt(hex.slice(5, 7), 16) * brightness + 34 * (1 - brightness));
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
