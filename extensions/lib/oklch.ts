/**
 * Colour maths for the wallpaper theme: sRGB to OKLCH and back, plus the WCAG
 * contrast ratio the palette floors are asserted on.
 *
 * Pure functions only: no IO, no clock, no randomness, so a palette is a function
 * of one accent colour and the tests can pin every number.
 */

export type Rgb = readonly [number, number, number];

export interface Oklch {
	/** Perceptual lightness, 0..1. */
	L: number;
	/** Chroma; 0 is grey. */
	C: number;
	/** Hue in degrees, 0..360. */
	H: number;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function toLinear(channel: number): number {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
	const clamped = clamp01(value);
	return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Parse one `#RRGGBB` (or `RRGGBB`) into channels, or undefined. */
export function hexToRgb(hex: string): Rgb | undefined {
	const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
	if (match === null) return undefined;
	const value = match[1] as string;
	return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function rgbToHex(rgb: Rgb): string {
	return '#' + rgb.map((channel) => Math.round(clamp01(channel / 255) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToOklab(rgb: Rgb): { L: number; a: number; b: number } {
	const r = toLinear(rgb[0]);
	const g = toLinear(rgb[1]);
	const b = toLinear(rgb[2]);

	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	return {
		L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
		a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
		b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
	};
}

/** Linear-light sRGB channels, which may fall outside 0..1 for an out-of-gamut colour. */
export function oklabToLinear(L: number, a: number, b: number): Rgb {
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;

	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

export function rgbToOklch(rgb: Rgb): Oklch {
	const { L, a, b } = rgbToOklab(rgb);
	const C = Math.hypot(a, b);
	const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
	return { L, C, H };
}

/** True when every linear channel sits inside the sRGB gamut. */
function inGamut(linear: Rgb): boolean {
	return linear.every((channel) => channel >= -0.0005 && channel <= 1.0005);
}

/**
 * OKLCH to hex. An out-of-gamut colour keeps its lightness and hue and gives up
 * chroma until it fits, which is what keeps a saturated wallpaper inside sRGB
 * instead of clipping to a wrong hue.
 */
export function oklchToHex(lch: Oklch): string {
	const L = clamp01(lch.L);
	const H = lch.H;
	const radians = (H * Math.PI) / 180;
	const attempt = (C: number): Rgb => {
		const linear = oklabToLinear(L, C * Math.cos(radians), C * Math.sin(radians));
		return [fromLinear(linear[0]) * 255, fromLinear(linear[1]) * 255, fromLinear(linear[2]) * 255];
	};

	let chroma = Math.max(0, lch.C);
	let rgb = attempt(chroma);
	let guard = 0;
	while (!inGamut(oklabToLinear(L, chroma * Math.cos(radians), chroma * Math.sin(radians))) && guard < 24) {
		chroma *= 0.85;
		rgb = attempt(chroma);
		guard += 1;
	}
	return rgbToHex([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])] as Rgb);
}

/** WCAG relative luminance of a colour. */
export function relativeLuminance(rgb: Rgb): number {
	return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const first = relativeLuminance(a);
	const second = relativeLuminance(b);
	const lighter = Math.max(first, second);
	const darker = Math.min(first, second);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Rotate a hue, keeping it inside 0..360. */
export function rotateHue(hue: number, degrees: number): number {
	return ((hue + degrees) % 360 + 360) % 360;
}
