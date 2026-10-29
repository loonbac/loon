/**
 * gentle-pi's own configuration files, read from disk and followed.
 *
 * LOON does not import a single module of gentle-pi: it reads the two files that
 * extension already writes and honours them, so the settings a person changes in
 * `/gentle:customization` also reach the LOON banner. Every read is tolerant on
 * purpose — a missing file, malformed JSON, a schema from another version or a
 * key LOON does not know all resolve to today's behaviour, never to an error.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { BANNER_COLORS, type BannerColor } from './accent.ts';

/** The schema gentle-pi stamps on `visual-customization.json`. */
export const GENTLE_VISUAL_SCHEMA = 'gentle-pi.visual-customization/v1';

/** Body densities the banner knows how to draw. */
export const DENSITIES = ['comfortable', 'compact', 'minimal'] as const;

export type Density = (typeof DENSITIES)[number];

/** Where gentle-pi puts the header: above the transcript, or under the editor. */
export const HEADER_PLACEMENTS = ['top', 'below-input'] as const;

export type HeaderPlacement = (typeof HEADER_PLACEMENTS)[number];

export const VISUAL_FILE_NAME = 'visual-customization.json';
export const BANNER_FILE_NAME = 'banner.json';

/** Everything LOON takes from gentle-pi, already resolved against defaults. */
export interface GentleSettings {
	density: Density;
	headerPlacement: HeaderPlacement;
	/** `banner.json`'s `showTextLogo`; the mark is drawn when this is true. */
	showTextLogo: boolean;
	/** `banner.json`'s `color`, or undefined when it never said anything usable. */
	accentColor: BannerColor | undefined;
}

/** What LOON draws when gentle-pi is absent, silent or unreadable. */
export const DEFAULT_GENTLE_SETTINGS: GentleSettings = {
	density: 'comfortable',
	headerPlacement: 'top',
	showTextLogo: true,
	accentColor: undefined,
};

/**
 * gentle-pi's config home, resolved the same way it resolves it: an explicit
 * override first, then the marker a bundled Gentle Shell exports, then the
 * standalone location under the user's home.
 */
export function gentleConfigHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	if (env.GENTLE_PI_CONFIG_HOME) return env.GENTLE_PI_CONFIG_HOME;
	const marker = env.GENTLE_SHELL_CONFIG_HOME;
	if (marker && isAbsolute(marker)) return marker;
	return join(home, '.pi', 'gentle-ai');
}

/** The two files LOON reads, under one config home. */
export function gentleConfigFiles(home: string): { visual: string; banner: string } {
	return { visual: join(home, VISUAL_FILE_NAME), banner: join(home, BANNER_FILE_NAME) };
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function member<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
	return typeof value === 'string' && (choices as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * The slice of `visual-customization.json` LOON follows.
 *
 * Returns undefined when the file as a whole is unusable — not JSON, or stamped
 * with a schema this version does not know — because a file from another shape
 * says nothing trustworthy about density or placement. A usable file only
 * contributes the fields that validate: a bad `density` never discards a good
 * `headerPlacement`, and unknown keys are ignored.
 */
export function parseVisualCustomization(
	raw: string | undefined,
): { density?: Density; headerPlacement?: HeaderPlacement } | undefined {
	if (raw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!record(parsed) || parsed.schema !== GENTLE_VISUAL_SCHEMA) return undefined;

	const density = member(parsed.density, DENSITIES);
	const headerPlacement = member(parsed.headerPlacement, HEADER_PLACEMENTS);
	return { ...(density === undefined ? {} : { density }), ...(headerPlacement === undefined ? {} : { headerPlacement }) };
}

/**
 * The slice of `banner.json` LOON follows. That file carries no schema — gentle-pi
 * validates it key by key — so the same tolerance applies here: a field that does
 * not validate is dropped and the rest still counts.
 */
export function parseBannerConfig(raw: string | undefined): { showTextLogo?: boolean; color?: BannerColor } | undefined {
	if (raw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!record(parsed)) return undefined;

	const showTextLogo = typeof parsed.showTextLogo === 'boolean' ? parsed.showTextLogo : undefined;
	const color = member(parsed.color, BANNER_COLORS);
	return { ...(showTextLogo === undefined ? {} : { showTextLogo }), ...(color === undefined ? {} : { color }) };
}

/** The one filesystem call LOON makes here; the tests pass their own. */
export interface GentleConfigReader {
	/** Contents of `path`, or undefined when it cannot be read at all. */
	read(path: string): string | undefined;
}

export const fileSystemReader: GentleConfigReader = {
	read: (path) => {
		try {
			return readFileSync(path, 'utf8');
		} catch {
			return undefined;
		}
	},
};

/** Resolve gentle-pi's settings for one config home. Never throws. */
export function readGentleSettings(home: string, reader: GentleConfigReader = fileSystemReader): GentleSettings {
	const files = gentleConfigFiles(home);
	// A reader that throws is as good as a missing file: defaults, never a crash.
	const read = (path: string): string | undefined => {
		try {
			return reader.read(path);
		} catch {
			return undefined;
		}
	};
	const visual = parseVisualCustomization(read(files.visual));
	const banner = parseBannerConfig(read(files.banner));

	return {
		density: visual?.density ?? DEFAULT_GENTLE_SETTINGS.density,
		headerPlacement: visual?.headerPlacement ?? DEFAULT_GENTLE_SETTINGS.headerPlacement,
		showTextLogo: banner?.showTextLogo ?? DEFAULT_GENTLE_SETTINGS.showTextLogo,
		accentColor: banner?.color ?? DEFAULT_GENTLE_SETTINGS.accentColor,
	};
}

/** True when two resolutions would draw the same banner. */
export function sameGentleSettings(a: GentleSettings, b: GentleSettings): boolean {
	return (
		a.density === b.density &&
		a.headerPlacement === b.headerPlacement &&
		a.showTextLogo === b.showTextLogo &&
		a.accentColor === b.accentColor
	);
}
