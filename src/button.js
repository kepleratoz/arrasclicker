import { darken } from "./utils.js";
import { mouse } from "./input.js";
import { drawText } from "./render.js";
import { game } from "./game.js";

export class Button {
	constructor(callback, fill) {
		this.callback = callback;
		this.fill = fill;
		this.stroke = darken(fill, 0.75);
	}
	render(ctx, x, y, w, h, label, disabled) {
		const hovered = !disabled && mouse.x > x && mouse.y > y && mouse.x < x + w && mouse.y < y + h;
		const pressed = hovered && mouse.left;
		ctx.lineWidth = 12 * game.scale;
		ctx.strokeStyle = "#222";
		ctx.strokeRect(x, y, w, h);
		ctx.fillStyle = pressed ? this.stroke : this.fill;
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = pressed ? this.fill : this.stroke;
		ctx.fillRect(x, y + h * 0.6, w, h * 0.4);
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
			ctx.fillStyle = isActive ? (this.segmentColors[i] || this.stroke) : darken(this.segmentColors[i] || "#888", 0.45);
			ctx.fillRect(sx + 2, segY, segW - 4, segH);
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
