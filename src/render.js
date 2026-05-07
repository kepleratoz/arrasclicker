import { game } from "./game.js";

export function drawText(ctx, text, x, y, isWarning = false, stroke = true, centered = false, size = 24 * game.scale) {
	if (centered) {
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
	} else {
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
	}
	ctx.font = size + "px Ubuntu";
	ctx.fillStyle = isWarning ? "#e7896d" : "#fff";
	ctx.strokeStyle = "#222";
	ctx.lineWidth = size / 4;
	if (stroke) ctx.strokeText(text, x, y);
	ctx.fillText(text, x, y);
}

export function drawPolygon(ctx, x, y, radius, angle, sides) {
	const screenScale = game.scale * game.room.fov;
	ctx.beginPath();
	if (sides === 0) {
		ctx.arc(x * screenScale, y * screenScale, radius * screenScale, 0, Math.PI * 2);
	} else {
		const step = (Math.PI * 2) / sides;
		for (let i = 0; i < sides; ++i) {
			ctx.lineTo(
				(x + Math.cos(angle + i * step) * radius) * screenScale,
				(y + Math.sin(angle + i * step) * radius) * screenScale,
			);
		}
	}
	ctx.closePath();
}
