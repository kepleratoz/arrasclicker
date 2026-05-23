import { darken } from "./utils.js";
import { mouse } from "./input.js";
import { drawText } from "./render.js";
import { game } from "./game.js";

// Sentinel for rainbow-cycling fills. Used in place of a hex color anywhere a
// Button / SliderButton supports the "rainbow shape" rolling-hue effect.
export const RAINBOW = "rainbow";

// Translucent fills (8-char hex like "#22222220") get a translucent border to
// match — keeps shadow-themed UI looking the same as shadow polygons.
function isTranslucentHex(c) { return typeof c === "string" && c.length === 9; }
function translucentBorder() { return "rgba(34,34,34,0.4)"; }
function rainbowFill()   { const h = (Date.now() * 0.1) % 360; return `hsl(${h}, 80%, 60%)`; }
function rainbowStroke() { const h = (Date.now() * 0.1) % 360; return `hsl(${h}, 60%, 35%)`; }

export class Button {
	constructor(callback, fill, borderColor) {
		this.callback = callback;
		this.fill = fill;
		this.stroke = fill === RAINBOW ? RAINBOW : darken(fill, 0.75);
		// Borders are always default black unless a callsite explicitly overrides.
		this.borderColor = borderColor ?? "#222";
	}
	render(ctx, x, y, w, h, label, disabled) {
		const hovered = !disabled && mouse.x > x && mouse.y > y && mouse.x < x + w && mouse.y < y + h;
		const pressed = hovered && mouse.left;
		// Rainbow fills cycle hue per render — matches the rainbow shape rendering.
		// The border stays the default flat color regardless of fill.
		const isRainbow = this.fill === RAINBOW || this.rainbow;
		const baseFill = isRainbow ? rainbowFill() : this.fill;
		const baseStroke = isRainbow ? rainbowStroke() : this.stroke;
		ctx.lineWidth = 12 * game.scale;
		ctx.strokeStyle = this.borderColor;
		ctx.strokeRect(x, y, w, h);
		ctx.fillStyle = pressed ? baseStroke : baseFill;
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = pressed ? baseFill : baseStroke;
		// Bottom-darker band: 40% of the button on short buttons, but capped at
		// 32*s on taller ones so the dark gradient doesn't dominate them.
		const darkH = Math.min(h * 0.4, 32 * game.scale);
		ctx.fillRect(x, y + h - darkH, w, darkH);
		if (hovered) {
			ctx.fillStyle = "rgba(255,255,255,0.1)";
			ctx.fillRect(x, y, w, h);
		}
		if (label) drawText(ctx, label, x + w / 2, y + h / 2, false, true, true, 24 * game.scale);
		if (disabled) {
			ctx.fillStyle = "rgba(0,0,0,0.2)";
			ctx.fillRect(x, y, w, h);
		}
		if (hovered && mouse.leftRelease) this.callback();
	}
}

export class SliderButton {
	constructor(values, getValue, setValue, fill, segmentColors) {
		this.values = values;
		this.getValue = getValue;
		this.setValue = setValue;
		this.fill = fill;
		this.stroke = darken(fill, 0.75);
		this.segmentColors = segmentColors || [];
	}
	render(ctx, x, y, w, h) {
		ctx.lineWidth = 12 * game.scale;
		ctx.strokeStyle = "#222";
		ctx.strokeRect(x, y, w, h);
		ctx.fillStyle = this.fill;
		ctx.fillRect(x, y, w, h);
		const padX = 8 * game.scale;
		const segH = 32 * game.scale;
		const segY = y + h - segH - 8 * game.scale;
		const segAreaW = w - padX * 2;
		const segW = segAreaW / this.values.length;
		const current = this.getValue();
		for (let i = 0; i < this.values.length; ++i) {
			const sx = x + padX + i * segW;
			const isActive = i === current;
			const segColor = this.segmentColors[i] || "#888";
			// Fill: rainbow segments cycle hue; everything else keeps its color (darker when inactive).
			const fill = segColor === RAINBOW
				? (isActive ? rainbowFill() : darken("#ff5cd4", 0.45))
				: (isActive ? segColor : darken(segColor, 0.45));
			ctx.fillStyle = fill;
			ctx.fillRect(sx + 2, segY, segW - 4, segH);
			// Outline: always the default scheme — bright white when active for the
			// selection highlight, default black otherwise.
			ctx.strokeStyle = isActive ? "#fff" : "#222";
			ctx.lineWidth = (isActive ? 4 : 2) * game.scale;
			ctx.strokeRect(sx + 2, segY, segW - 4, segH);
			drawText(ctx, this.values[i], sx + segW / 2, segY + segH / 2, false, true, true, 18 * game.scale);
		}
		const hovered = mouse.x > x && mouse.y > y && mouse.x < x + w && mouse.y < y + h;
		if (hovered && mouse.leftRelease && mouse.y >= segY && mouse.y <= segY + segH) {
			const idx = Math.floor((mouse.x - x - padX) / segW);
			if (idx >= 0 && idx < this.values.length) this.setValue(idx);
		}
	}
}
