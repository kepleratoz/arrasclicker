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
