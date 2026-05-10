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

// OSA-style health bar: black background line + colored health line, both round-capped.
// Renders only when health < maxHealth. (cx, cy) is the entity center; halfSize is the bar half-width.
export function drawHealthBar(ctx, cx, cy, halfSize, health, maxHealth, scale, forceShow = false) {
	if (maxHealth <= 0) return;
	if (!forceShow && health >= maxHealth) return;
	const barY = cy + halfSize + 14 * scale;
	const bgW = 6 * scale;
	const fgW = 4 * scale;
	const ratio = Math.max(0, Math.min(1, health / maxHealth));
	const prevCap = ctx.lineCap;
	ctx.lineCap = "round";
	ctx.strokeStyle = "#000000";
	ctx.lineWidth = bgW;
	ctx.beginPath();
	ctx.moveTo(cx - halfSize, barY);
	ctx.lineTo(cx + halfSize, barY);
	ctx.stroke();
	ctx.strokeStyle = "#85e37d";
	ctx.lineWidth = fgW;
	ctx.beginPath();
	ctx.moveTo(cx - halfSize, barY);
	ctx.lineTo(cx - halfSize + 2 * halfSize * ratio, barY);
	ctx.stroke();
	ctx.lineCap = prevCap;
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
