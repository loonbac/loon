/**
 * One logo animation per session, shared by every installed header.
 *
 * Re-installing the header (session start, a re-assert after another extension
 * claimed the header, loon:look) must not restart the logo, so the frame index
 * and the interval live here instead of inside the component.
 */
import type { TUI } from '@earendil-works/pi-tui';
import { LOGO_ANIMATION_INTERVAL_MS, LOGO_FRAME_COUNT } from './logo.ts';

export interface LogoClock {
	/** Current animation frame, from 0 to `frameCount - 1`. */
	getFrame(): number;
	/** Point renders at the TUI that currently owns the header. */
	attach(tui: TUI | undefined): void;
	/** Stop the interval; the clock is unusable afterwards. */
	dispose(): void;
}

export function createLogoClock(
	options: { frameCount?: number; intervalMs?: number } = {},
): LogoClock {
	const frameCount = Math.max(1, options.frameCount ?? LOGO_FRAME_COUNT);
	const intervalMs = options.intervalMs ?? LOGO_ANIMATION_INTERVAL_MS;
	let frame = 0;
	let target: TUI | undefined;
	let timer: NodeJS.Timeout | undefined;

	const stop = (): void => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const start = (): void => {
		if (timer || frame >= frameCount - 1) return;
		timer = setInterval(() => {
			if (frame < frameCount - 1) frame += 1;
			if (frame >= frameCount - 1) stop();
			try {
				target?.requestRender();
			} catch {
				stop();
			}
		}, intervalMs);
		timer.unref?.();
	};

	return {
		getFrame: () => frame,
		attach: (tui) => {
			target = tui;
			if (tui) start();
		},
		dispose: () => {
			stop();
			target = undefined;
		},
	};
}
