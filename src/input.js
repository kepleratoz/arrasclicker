class Mouse {
	x = 0;
	y = 0;
	left = false;
	leftClick = false;
	leftRelease = false;
	right = false;
	move(e) {
		const dpr = window.devicePixelRatio;
		this.x = e.clientX * dpr;
		this.y = e.clientY * dpr;
	}
	down(e) {
		switch (e.button) {
			case 0: this.left = true; this.leftClick = true; break;
			case 2: this.right = true; break;
		}
	}
	up(e) {
		switch (e.button) {
			case 0: this.left = false; this.leftRelease = true; break;
			case 2: this.right = false; break;
		}
	}
	resetClicks() {
		this.leftClick = false;
		this.leftRelease = false;
	}
}

export const mouse = new Mouse();

class Keys {
	pressed = new Set();
	justPressed = new Set();
	down(e) {
		if (!this.pressed.has(e.code)) this.justPressed.add(e.code);
		this.pressed.add(e.code);
	}
	up(e) { this.pressed.delete(e.code); }
	resetFrame() { this.justPressed.clear(); }
}

export const keys = new Keys();

window.addEventListener("mousemove", (e) => mouse.move(e));
window.addEventListener("mousedown", (e) => mouse.down(e));
window.addEventListener("mouseup", (e) => mouse.up(e));
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => keys.down(e));
window.addEventListener("keyup", (e) => keys.up(e));
