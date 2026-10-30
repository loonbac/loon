#!/usr/bin/env node
/**
 * Patch gentle-pi's own customization menu so it offers LOON as a third banner
 * source, teach gentle-pi's banner to stay out of the way when LOON owns the slot,
 * and let the shell bar drop its brand under a theme LOON generated.
 *
 * This edits another installed package, so it is deliberately paranoid:
 *
 *   - the files must be exactly the gentle-pi 4.5.1 build the patch was written
 *     against (md5), or nothing is touched;
 *   - every anchor must appear exactly once, so a partial match cannot leave half
 *     a patch behind;
 *   - before a real file is replaced, the patched copy is imported in a child
 *     process with jiti - the loader pi itself uses - to prove it parses and still
 *     exports a factory;
 *   - the originals go to a timestamped backup first, and `revert` puts them back
 *     and verifies their md5.
 *
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts check
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts apply
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts revert
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The gentle-pi release this patch is written for. */
export const GENTLE_PI_VERSION = '4.5.1';

/** Every patched file carries this marker, which also makes the patch idempotent. */
export const PATCH_MARKER = 'LOON banner patch';

export interface PatchEdit {
	/** Text that must appear exactly once in the unpatched file. */
	anchor: string;
	/** What replaces it; it always contains the anchor itself. */
	replacement: string;
}

export interface TargetSpec {
	/** Path relative to the gentle-pi package root. */
	file: string;
	/** md5 of the untouched 4.5.1 build. */
	md5: string;
	edits: PatchEdit[];
	/** md5 of the exact bytes this version writes. */
	md5Patched?: string;
	/** md5 of the bytes each earlier version wrote, so they can be upgraded. */
	md5PatchedV1?: string[];
	/**
	 * Text that only the current patch version writes. Used to explain a file that
	 * carries our marker but matches neither version: it was edited afterwards.
	 */
	v2Marker?: string;
}

const SHELL_INIT_ANCHOR = "\t\t\tlet banner = await readBannerConfig(bannerHome).catch(error => { close(); throw error; });\n\t\t\tif (closed) return;";
const SHELL_INIT_ADDITION = "\t\t\t// LOON banner patch v2: the banner source and the accent choice live in\n\t\t\t// LOON's own settings file, because writeBannerConfig() persists only this\n\t\t\t// file's three keys and would drop anything else written here.\n\t\t\tconst loonSettingsPath = join(process.env.PI_CODING_AGENT_DIR || join(os.homedir(), \".pi\", \"agent\"), \"loon-tui.json\");\n\t\t\tconst readLoonSettings = async (): Promise<Record<string, unknown>> => {\n\t\t\t\ttry {\n\t\t\t\t\tconst parsed: unknown = JSON.parse(await readFile(loonSettingsPath, \"utf8\"));\n\t\t\t\t\treturn typeof parsed === \"object\" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};\n\t\t\t\t} catch {\n\t\t\t\t\treturn {};\n\t\t\t\t}\n\t\t\t};\n\t\t\tlet loonSettings = await readLoonSettings();\n\t\t\tlet loonBannerSource: \"loon\" | \"rose\" | \"off\" = loonSettings.source === \"rose\" || loonSettings.source === \"off\" ? loonSettings.source : \"loon\";\n\t\t\tconst writeLoonSettings = async (next: Record<string, unknown>) => {\n\t\t\t\tconst { mkdir, rename, writeFile } = await import(\"node:fs/promises\");\n\t\t\t\tawait mkdir(dirname(loonSettingsPath), { recursive: true });\n\t\t\t\tconst temporary = `${loonSettingsPath}.${process.pid}.tmp`;\n\t\t\t\tawait writeFile(temporary, `${JSON.stringify(next, null, \"\\t\")}\\n`, { mode: 0o600 });\n\t\t\t\tawait rename(temporary, loonSettingsPath);\n\t\t\t\tloonSettings = next;\n\t\t\t};\n\t\t\tconst saveLoonBannerSource = async (source: \"loon\" | \"rose\" | \"off\") => {\n\t\t\t\tawait writeLoonSettings({ ...loonSettings, source });\n\t\t\t\tloonBannerSource = source;\n\t\t\t};\n\t\t\tconst saveLoonAccent = async (accent: \"theme\" | \"banner\" | \"wallpaper\") => {\n\t\t\t\tawait writeLoonSettings({ ...loonSettings, accent });\n\t\t\t};\n\t\t\tconst readWallpaperAccent = async (): Promise<{ hex: string; rgb: [number, number, number] } | undefined> => {\n\t\t\t\ttry {\n\t\t\t\t\tconst { readFile: readText } = await import(\"node:fs/promises\");\n\t\t\t\t\tconst home = process.env.HOME ?? os.homedir();\n\t\t\t\t\tconst raw = await readText(join(home, \".config\", \"mpvpaper\", \"accent.txt\"), \"utf8\");\n\t\t\t\t\tconst match = /^\\s*#?([0-9a-fA-F]{6})\\s*$/.exec(raw);\n\t\t\t\t\tif (match === null) return undefined;\n\t\t\t\t\tconst hex = match[1]!.toUpperCase();\n\t\t\t\t\treturn { hex: \"#\" + hex, rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] };\n\t\t\t\t} catch {\n\t\t\t\t\treturn undefined;\n\t\t\t\t}\n\t\t\t};\n\t\t\tlet loonWallpaperAccent = await readWallpaperAccent();";

const SHELL_ROWS_ANCHOR = "\t\t\tadd(() => `Banner rose: ${banner.showRose ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showRose = !next.showRose;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showRose: !banner.showRose }));\n\t\t\tadd(() => `Banner text logo: ${banner.showTextLogo ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showTextLogo = !next.showTextLogo;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showTextLogo: !banner.showTextLogo }));\n\t\t\tfor (const color of BANNER_COLORS) add(\n\t\t\t\t() => `Banner color: ${color}${banner.color === color ? \" (current)\" : \"\"}`,\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { const next = { ...await readBannerConfigForEdit(bannerHome), color }; await writeBannerConfig(next, bannerHome); banner = next; },\n\t\t\t\t() => bannerPreview({ ...banner, color }),\n\t\t\t);";
const SHELL_ROWS_REPLACEMENT = "\t\t\t// LOON banner patch v2: one source row, three states, cycling on select.\n\t\t\tconst LOON_BANNER_SOURCES = [\"loon\", \"rose\", \"off\"] as const;\n\t\t\tconst nextLoonBannerSource = () => LOON_BANNER_SOURCES[(LOON_BANNER_SOURCES.indexOf(loonBannerSource) + 1) % LOON_BANNER_SOURCES.length];\n\t\t\tadd(() => `Banner: ${loonBannerSource}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tawait saveLoonBannerSource(nextLoonBannerSource());\n\t\t\t}, () => {\n\t\t\t\tconst next = nextLoonBannerSource();\n\t\t\t\tif (next === \"rose\") return bannerPreview(banner);\n\t\t\t\treturn next === \"off\"\n\t\t\t\t\t? { title: \"Banner \u00b7 off (static)\", sample: \"\u00b7  pi's own header at next startup\" }\n\t\t\t\t\t: { title: \"Banner \u00b7 LOON (static)\", sample: \"\u2588  LOON header at next startup\" };\n\t\t\t});\n\t\t\tif (loonBannerSource === \"rose\") add(() => `Banner text logo: ${banner.showTextLogo ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showTextLogo = !next.showTextLogo;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showTextLogo: !banner.showTextLogo }));\n\t\t\t// LOON banner patch: the theme's own accent, so the banner can follow the\n\t\t\t// interface instead of the wallpaper deciding for it.\n\t\t\tadd(\n\t\t\t\t(labelWidth?: number) => {\n\t\t\t\t\tconst suffix = loonSettings.accent === \"theme\" ? \" (current)\" : \"\";\n\t\t\t\t\tconst full = \"Banner color: theme (LOON)\";\n\t\t\t\t\tconst short = \"Banner color: theme\";\n\t\t\t\t\tconst fits = labelWidth === undefined || labelWidth >= full.length + suffix.length;\n\t\t\t\t\treturn (fits ? full : short) + suffix;\n\t\t\t\t},\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { await saveLoonAccent(\"theme\"); },\n\t\t\t\t() => ({ title: \"Theme accent (static)\", sample: \"·  the active theme's accent role\" }),\n\t\t\t);\n\t\t\t// LOON banner patch v2: the four named colours also return the accent to\n\t\t\t// gentle-pi's palette, so picking pink after wallpaper is not a no-op.\n\t\t\tfor (const color of BANNER_COLORS) add(\n\t\t\t\t() => `Banner color: ${color}${loonSettings.accent !== \"wallpaper\" && loonSettings.accent !== \"theme\" && banner.color === color ? \" (current)\" : \"\"}`,\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { const next = { ...await readBannerConfigForEdit(bannerHome), color }; await writeBannerConfig(next, bannerHome); banner = next; await saveLoonAccent(\"banner\"); },\n\t\t\t\t() => bannerPreview({ ...banner, color }),\n\t\t\t);\n\t\t\tadd(\n\t\t\t\t(labelWidth?: number) => {\n\t\t\t\t\t// The marker is LOON's, and it is the first thing to go when the row\n\t\t\t\t\t// cannot hold the whole label: (current) is never sacrificed.\n\t\t\t\t\tconst suffix = loonSettings.accent === \"wallpaper\" ? \" (current)\" : \"\";\n\t\t\t\t\tconst full = \"Banner color: wallpaper (LOON)\";\n\t\t\t\t\tconst short = \"Banner color: wallpaper\";\n\t\t\t\t\tconst fits = labelWidth === undefined || labelWidth >= full.length + suffix.length;\n\t\t\t\t\treturn (fits ? full : short) + suffix;\n\t\t\t\t},\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { await saveLoonAccent(\"wallpaper\"); loonWallpaperAccent = await readWallpaperAccent(); },\n\t\t\t\t() => loonWallpaperAccent === undefined\n\t\t\t\t\t? { title: \"Wallpaper accent \u00b7 unavailable (static)\", sample: \"\u00b7  falls back to the theme accent\" }\n\t\t\t\t\t: { title: `Wallpaper accent \u00b7 ${loonWallpaperAccent.hex} (static)`, sample: `\\x1b[38;2;${loonWallpaperAccent.rgb[0]};${loonWallpaperAccent.rgb[1]};${loonWallpaperAccent.rgb[2]}m\u2588\\x1b[0m  wallpaper accent` },\n\t\t\t);\n\t\t\t// LOON banner patch: the mark is LOON's own switch. gentle-pi's showTextLogo\n\t\t\t// belongs to its own banner and never reaches this glyph.\n\t\t\tadd(() => `Mark: ${loonSettings.mark === false ? \"off\" : \"on\"}`, \"Mark saved.\", async () => {\n\t\t\t\tawait writeLoonSettings({ ...loonSettings, mark: loonSettings.mark === false });\n\t\t\t});";

const BANNER_CONFIG_ANCHOR = "    const bannerConfig = await readBannerConfig();";
const BANNER_CONFIG_ADDITION = "    // LOON banner patch: LOON's own setting decides who paints the header. \"rose\"\n    // - and a missing setting, so an unpatched LOON keeps working - leaves this\n    // banner in charge; \"loon\" and \"off\" both mean it must not install.\n    const loonBannerSource = await readLoonBannerSource();\n    if (loonBannerSource === \"loon\" || loonBannerSource === \"off\") return;";

const BANNER_EVENT_ANCHOR = "  pi.on(\"session_start\", async (_event, ctx) => {";
const BANNER_EVENT_REPLACEMENT = "  // LOON banner patch: read the banner source from LOON's own settings file.\n  async function readLoonBannerSource(): Promise<string | undefined> {\n    try {\n      const { readFile } = await import(\"node:fs/promises\");\n      const { join } = await import(\"node:path\");\n      const { homedir } = await import(\"node:os\");\n      const home = process.env.PI_CODING_AGENT_DIR || join(homedir(), \".pi\", \"agent\");\n      const parsed: unknown = JSON.parse(await readFile(join(home, \"loon-tui.json\"), \"utf8\"));\n      if (typeof parsed !== \"object\" || parsed === null) return undefined;\n      const source = (parsed as Record<string, unknown>).source;\n      return typeof source === \"string\" ? source : undefined;\n    } catch {\n      return undefined;\n    }\n  }\n  pi.on(\"session_start\", async (_event, ctx) => {";

/** The exact anchors, so a test can build a stand-in file around them. */
// The prompt card painted its band with `toolSuccessBg`, borrowing a role that means
// "a tool succeeded" only because it needed some background. A surface is not a
// success: `selection` is the surface a theme tints with its accent.
// pi only accepts colour keys here, not vars: `selection` is a var, and the colour key
// bound to it is `selectedBg`. Passing `selection` throws "Unknown theme color", which
// gentle-pi catches into an empty background, so the card silently falls back.

const VIEW_LABEL_TYPE_ANCHOR = '\tlabel: string | (() => string);';
const VIEW_LABEL_TYPE_REPLACEMENT = '\tlabel: string | ((width?: number) => string);';

const VIEW_LABEL_CALL_ANCHOR =
	'\t\t\tconst item = navOnly ? this.categories[start + i] : row ? typeof row.label === "function" ? row.label() : row.label : undefined;';
const VIEW_LABEL_CALL_REPLACEMENT =
	'\t\t\tconst item = navOnly ? this.categories[start + i] : row ? typeof row.label === "function" ? row.label(rightWidth) : row.label : undefined;';

// LOON banner patch: the header bar's brand. A theme this plugin generates carries
// " (LOON)" at the end of its name, and while one is active the bar drops the brand,
// because the header already says which tool this is. Any other theme keeps the
// brand, and a theme whose name is missing or not a string fails open (brand shown).
const SHELL_BAR_BRAND_ANCHOR = 'const HEADER_BRAND = "✿ Gentle Shell";';
const SHELL_BAR_BRAND_ADDITION = [
	'// LOON banner patch: a theme this plugin generates marks itself with " (LOON)" in',
	'// its name, and that one fact drives two decisions: the bar drops a brand the',
	'// header already implies, and it stops advertising the usage shortcut. Any other',
	'// theme keeps both, and a theme whose name is missing or not a string fails open',
	'// (brand shown, hint shown) instead of hiding either by accident.',
	'function loonThemeActive(theme: ShellBarTheme): boolean {',
	'\tconst name = (theme as ShellBarTheme & { name?: unknown }).name;',
	'\treturn typeof name === "string" && name.endsWith(" (LOON)");',
	'}',
	'',
	'function barBrandSegments(theme: ShellBarTheme, text: string, options: { bold?: boolean; hidden?: boolean } = {}): string[] {',
	'\tif (options.hidden || loonThemeActive(theme)) return [];',
	'\treturn [options.bold ? theme.fg(ROLE.BRAND, theme.bold(text)) : theme.fg(ROLE.BRAND, text)];',
	'}',
].join('\n');

// The header's usage affordance. Under a LOON theme the shortcut hint goes, and a
// segment with nothing to report goes with it: a bare "usage" is noise, not an
// affordance. The shortcut itself stays registered; only the reminder is silenced.
const SHELL_BAR_USAGE_ANCHOR = [
	'function usageSegmentText(windows: UsageWindow[], theme: ShellBarTheme, stage: UsageStage, hint: string | undefined, paint?: GaugePaint): string {',
	'\tconst label = theme.fg(USAGE_LABEL_ROLE, "usage");',
	'\tconst shown = stage === "primary" ? windows.slice(0, 1) : windows;',
	'\tconst body = shown.map((window) => usageWindowText(window, theme, stage === "full", paint)).join(` ${theme.fg(ROLE.LABEL, "·")} `);',
	'\tconst head = body.length > 0 ? `${label} ${body}` : label;',
	'\treturn hint ? `${head} ${theme.fg(ROLE.LABEL, "·")} ${theme.fg(USAGE_HINT_ROLE, hint)}` : head;',
	'}',
].join('\n');
const SHELL_BAR_USAGE_REPLACEMENT = [
	'function usageSegmentText(windows: UsageWindow[], theme: ShellBarTheme, stage: UsageStage, hint: string | undefined, paint?: GaugePaint): string | undefined {',
	'\t// LOON banner patch: with a theme LOON generated the header stops advertising',
	'\t// the usage shortcut, and a segment with nothing to report is dropped whole',
	'\t// rather than left as an orphan "usage". The shortcut stays registered; only',
	'\t// this reminder is silenced.',
	'\tconst loon = loonThemeActive(theme);',
	'\tconst label = theme.fg(USAGE_LABEL_ROLE, "usage");',
	'\tconst shown = stage === "primary" ? windows.slice(0, 1) : windows;',
	'\tconst body = shown.map((window) => usageWindowText(window, theme, stage === "full", paint)).join(` ${theme.fg(ROLE.LABEL, "·")} `);',
	'\tif (loon && body.length === 0) return undefined;',
	'\tconst head = body.length > 0 ? `${label} ${body}` : label;',
	'\tconst shownHint = loon ? undefined : hint;',
	'\treturn shownHint ? `${head} ${theme.fg(ROLE.LABEL, "·")} ${theme.fg(USAGE_HINT_ROLE, shownHint)}` : head;',
	'}',
].join('\n');

// loon gives the whole chrome one column of margin, and the bar is the last piece
// outside it: column 0 stays unpainted, the painted block starts in column 1 and
// still closes on the last column, exactly like the prompt band.
const SHELL_BAR_MARGIN_IMPORT_ANCHOR = 'import { CARD_TONE, floatRows, panelInnerWidth, renderCard } from "./shell-card.ts";';
const SHELL_BAR_MARGIN_IMPORT_REPLACEMENT = 'import { CARD_STYLE, CARD_TONE, cardStyle, floatRows, panelInnerWidth, renderCard } from "./shell-card.ts";';

const SHELL_BAR_MARGIN_ROW_ANCHOR = [
	'\tconst { inner, open } = painted;',
	'\t// The background spans the full width: the margin cells are painted too, so',
	'\t// the bar reaches both edges with no frame on its sides.',
	'\tconst side = `${open} `;',
	'\treturn `${side}${inner.slice(open.length, -BG_RESET.length)}${side}${BG_RESET}`;',
].join('\n');
const SHELL_BAR_MARGIN_ROW_REPLACEMENT = [
	'\tconst { inner, open } = painted;',
	'\tconst body = inner.slice(open.length, -BG_RESET.length);',
	'\t// loon keeps one column of margin across the whole chrome, so its bar starts in',
	'\t// column 1 like the prompt band and the cards, and still closes on the last column.',
	'\t// The content width is the same either way, so the bar cascade does not move.',
	'\tif (cardStyle() === CARD_STYLE.LOON) return ` ${open}${body}${open} ${BG_RESET}`;',
	'\t// The background spans the full width: the margin cells are painted too, so',
	'\t// the bar reaches both edges with no frame on its sides.',
	'\tconst side = `${open} `;',
	'\treturn `${side}${body}${side}${BG_RESET}`;',
].join('\n');

const SHELL_BAR_MARGIN_PADDING_ANCHOR = [
	'\tconst padding = `${painted.open}${" ".repeat(targetWidth)}${BG_RESET}`;',
	'\tif (presentation?.headerPlacement === "below-input") {',
	'\t\t// A lower one-eighth block hugs the painted padding in the next row.',
	'\t\tconst upperEdge = theme.fg(HEADER_RULE_ROLE, "▁".repeat(targetWidth));',
].join('\n');
const SHELL_BAR_MARGIN_PADDING_REPLACEMENT = [
	'\t// The padding rows and the edge line are part of the bar, so under loon they take',
	'\t// the same margin as its content row rather than starting in column 0.',
	'\tconst margin = cardStyle() === CARD_STYLE.LOON ? " " : "";',
	'\tconst blockWidth = Math.max(0, targetWidth - margin.length);',
	'\tconst padding = `${margin}${painted.open}${" ".repeat(blockWidth)}${BG_RESET}`;',
	'\tif (presentation?.headerPlacement === "below-input") {',
	'\t\t// A lower one-eighth block hugs the painted padding in the next row.',
	'\t\tconst upperEdge = `${margin}${theme.fg(HEADER_RULE_ROLE, "▁".repeat(blockWidth))}`;',
].join('\n');

const SHELL_BAR_MARGIN_RULE_ANCHOR = [
	'\tif (floatHeaderPaint(theme, targetWidth, () => "") !== undefined) return theme.fg(HEADER_RULE_ROLE, HEADER_EDGE_CHAR.repeat(targetWidth));',
	'\treturn theme.fg(HEADER_RULE_ROLE, HEADER_RULE_CHAR.repeat(targetWidth));',
].join('\n');
const SHELL_BAR_MARGIN_RULE_REPLACEMENT = [
	'\t// Under loon the rule row keeps the chrome one-column margin too.',
	'\tconst margin = cardStyle() === CARD_STYLE.LOON ? " " : "";',
	'\tconst blockWidth = Math.max(0, targetWidth - margin.length);',
	'\tif (floatHeaderPaint(theme, targetWidth, () => "") !== undefined) return `${margin}${theme.fg(HEADER_RULE_ROLE, HEADER_EDGE_CHAR.repeat(blockWidth))}`;',
	'\treturn `${margin}${theme.fg(HEADER_RULE_ROLE, HEADER_RULE_CHAR.repeat(blockWidth))}`;',
].join('\n');

// The one-line bar paints its own brand text under a different constant.
const SHELL_BAR_MINIMAL_ANCHOR =
	'\t\t...(presentation?.density === "minimal" ? [] : [theme.fg(ROLE.BRAND, SHELL_BAR_BRAND)]),';
const SHELL_BAR_MINIMAL_REPLACEMENT =
	'\t\t...barBrandSegments(theme, SHELL_BAR_BRAND, { hidden: presentation?.density === "minimal" }),';

// The header's last-resort widths are built from the brand alone, so they must not
// invent one when it is hidden.
const SHELL_BAR_FALLBACK_ANCHOR =
	'\tconst brand = presentation?.density === "minimal" ? "" : theme.fg(ROLE.BRAND, theme.bold(HEADER_BRAND));';
const SHELL_BAR_FALLBACK_REPLACEMENT =
	'\tconst brand = barBrandSegments(theme, HEADER_BRAND, { bold: true, hidden: presentation?.density === "minimal" })[0] ?? "";';

// The header's left-hand widths, brand included. A hidden brand must not leave a
// lone stage, a leading separator or a blank row, so the narrowest stage becomes
// the bare model id and the brand-only stage disappears with the brand.
const SHELL_BAR_STAGES_ANCHOR = [
	'function headerLeftStages(model: ShellHeaderModel, theme: ShellBarTheme, showModelDetails: boolean): string[][] {',
	'\tconst brand = theme.fg(ROLE.BRAND, theme.bold(HEADER_BRAND));',
	'\tconst location = locationSegment(model, theme);',
	'\tif (!showModelDetails) return [[brand, location], [brand]];',
	'\tconst withEffort = executionSegment(model.modelId, model.effort, theme);',
	'\tconst modelOnly = executionSegment(model.modelId, undefined, theme);',
].join('\n');
const SHELL_BAR_STAGES_REPLACEMENT = [
	'function headerLeftStages(model: ShellHeaderModel, theme: ShellBarTheme, showModelDetails: boolean, presentation?: Presentation): string[][] {',
	'\t// LOON banner patch: both decisions live here now, because minimal density and a',
	'\t// LOON theme each take the brand away, and the stages must be built from the',
	'// segments that actually show. The arithmetic below is the same as it always was.',
	'\tconst loon = loonThemeActive(theme);',
	'\tconst brandSegments = presentation?.density === "minimal" ? [] : barBrandSegments(theme, HEADER_BRAND, { bold: true });',
	'\tconst location = locationSegment(model, theme);',
	'\tif (!showModelDetails) return loon ? [[location]] : [[...brandSegments, location], brandSegments];',
	'\tconst withEffort = executionSegment(model.modelId, model.effort, theme);',
	'\tconst modelOnly = executionSegment(model.modelId, undefined, theme);',
].join('\n');

const SHELL_BAR_STAGES_TAIL_ANCHOR = [
	'\treturn [',
	'\t\t[brand, location, withProfile],',
	'\t\t[brand, location, withEffort],',
	'\t\t[brand, location, modelOnly],',
	'\t\t[brand, modelOnly],',
	'\t\t[brand],',
	'\t];',
].join('\n');
const SHELL_BAR_STAGES_TAIL_REPLACEMENT = [
	'\tconst withBrand = (segments: string[]) => [...brandSegments, ...segments];',
	'\t// The brand-alone stage stays for every theme that can paint a brand, exactly as',
	'\t// it was, empty included when density took the brand; with a LOON theme it would',
	'\t// be an empty stage and nothing else, so it goes.',
	'\treturn [',
	'\t\twithBrand([location, withProfile]),',
	'\t\twithBrand([location, withEffort]),',
	'\t\twithBrand([location, modelOnly]),',
	'\t\twithBrand([modelOnly]),',
	'\t\t...(loon ? [] : [brandSegments]),',
	'\t];',
].join('\n');

// The call site used to slice the brand off every stage for minimal density; the
// decision now lives inside headerLeftStages, so it needs the presentation.
const SHELL_BAR_CALLSITE_ANCHOR = [
	'\tconst leftStages = headerLeftStages(model, theme, presentation?.visibility.modelDetails !== false)',
	'\t\t.map((stage) => presentation?.density === "minimal" ? stage.slice(1) : stage);',
].join('\n');
const SHELL_BAR_CALLSITE_REPLACEMENT =
	'\tconst leftStages = headerLeftStages(model, theme, presentation?.visibility.modelDetails !== false, presentation);';

// Card style loon: lib/shell-card.ts
const SHELL_CARD_1_ANCHOR = 'export const CARD_STYLE = {\n\tNEON: "neon",\n\tFLOAT: "float",\n} as const;';
const SHELL_CARD_1_REPLACEMENT = 'export const CARD_STYLE = {\n\tNEON: "neon",\n\tFLOAT: "float",\n\tLOON: "loon",\n} as const;';
const SHELL_CARD_2_ANCHOR = 'export function cardStyle(): CardStyle {\n\treturn styleState[CARD_STYLE_SLOT] === CARD_STYLE.NEON ? CARD_STYLE.NEON : CARD_STYLE.FLOAT;\n}';
const SHELL_CARD_2_REPLACEMENT = '// Every style is one geometry: how far the panel is inset on each side, and whether it\n// paints a tone background at all. float and neon keep the numbers they always had; loon\n// puts the border in column 0 and the text in column 2, with two columns of air on the\n// right, so the chrome and the conversation share one content box.\ninterface CardGeometry {\n\tbackground: boolean;\n\tpadLeft: number;\n\tpadRight: number;\n}\n\nconst CARD_GEOMETRY: Record<CardStyle, CardGeometry> = {\n\tneon: { background: false, padLeft: 0, padRight: 0 },\n\tfloat: { background: true, padLeft: 1, padRight: 1 },\n\tloon: { background: true, padLeft: 1, padRight: 1 },\n};\n\nfunction cardGeometry(): CardGeometry {\n\treturn CARD_GEOMETRY[cardStyle()] ?? CARD_GEOMETRY.float;\n}\n\nexport function cardStyle(): CardStyle {\n\tconst stored = styleState[CARD_STYLE_SLOT];\n\treturn stored === CARD_STYLE.NEON || stored === CARD_STYLE.LOON ? stored : CARD_STYLE.FLOAT;\n}';
const SHELL_CARD_3_ANCHOR = '\treturn cardStyle() === CARD_STYLE.FLOAT && Math.floor(width) >= FLOAT_MIN_WIDTH ? panelOpener(theme, tone) : "";';
const SHELL_CARD_3_REPLACEMENT = '\treturn cardGeometry().background && Math.floor(width) >= FLOAT_MIN_WIDTH ? panelOpener(theme, tone) : "";';
const SHELL_CARD_4_ANCHOR = 'function paintFloat(rows: readonly string[], open: string): string[] {\n\tconst margin = " ".repeat(FLOAT_MARGIN);\n\treturn rows.map((row) => `${margin}${open}${row.replace(BG_CLEARING, (reset) => reset + open)}${BG_RESET}${margin}`);\n}';
const SHELL_CARD_4_REPLACEMENT = 'function paintFloat(rows: readonly string[], open: string): string[] {\n\tconst geometry = cardGeometry();\n\tconst left = " ".repeat(geometry.padLeft);\n\tconst right = " ".repeat(geometry.padRight);\n\t// A painted row may not begin with an escape: the first cell has to be printable, or a\n\t// consumer that trims that cell takes the ESC with it and the terminal prints the\n\t// parameter. Every painted geometry therefore keeps padLeft >= 1, and the test asserts\n\t// it from the rendered bytes rather than from this comment.\n\treturn rows.map((row) => `${left}${open}${row.replace(BG_CLEARING, (reset) => reset + open)}${BG_RESET}${right}`);\n}\n';
const SHELL_CARD_5_ANCHOR = '\tconst inner = target - FLOAT_MARGIN * 2;';
const SHELL_CARD_5_REPLACEMENT = '\tconst inner = target - cardGeometry().padLeft - cardGeometry().padRight;';
const SHELL_CARD_6_ANCHOR = '\treturn floatOpener(theme, tone, width) ? cardInnerWidth(Math.floor(width) - FLOAT_MARGIN * 2) : cardInnerWidth(width);';
const SHELL_CARD_6_REPLACEMENT = '\tconst geometry = cardGeometry();\n\treturn floatOpener(theme, tone, width) ? cardInnerWidth(Math.floor(width) - geometry.padLeft - geometry.padRight) : cardInnerWidth(width);';
const SHELL_CARD_7_ANCHOR = '\tif (open) return paintFloat(withChrome(FLOAT_CHROME, () => floatPanel(card, theme, Math.floor(width) - FLOAT_MARGIN * 2, options)), open);';
const SHELL_CARD_7_REPLACEMENT = '\tif (open) return paintFloat(withChrome(FLOAT_CHROME, () => floatPanel(card, theme, Math.floor(width) - cardGeometry().padLeft - cardGeometry().padRight, options)), open);';
// Card style loon: lib/card-style-policy.ts
const CARD_STYLE_POLICY_1_ANCHOR = 'function isCardStyle(value: unknown): value is CardStyle {\n\treturn value === CARD_STYLE.NEON || value === CARD_STYLE.FLOAT;\n}';
const CARD_STYLE_POLICY_1_REPLACEMENT = 'function isCardStyle(value: unknown): value is CardStyle {\n\treturn value === CARD_STYLE.NEON || value === CARD_STYLE.FLOAT || value === CARD_STYLE.LOON;\n}';
// Card style loon: lib/shell-prompt.ts
const SHELL_PROMPT_1_ANCHOR = '\tlet background = "";\n\tif (style === CARD_STYLE.FLOAT && width >= 10 && bg) {';
const SHELL_PROMPT_1_REPLACEMENT = '\tlet background = "";\n\t// loon paints the same band as float; it only changes where the rule and the text\n\t// sit, which resolvePromptLayout reports through chrome below.\n\tconst painted = (style === CARD_STYLE.FLOAT || style === CARD_STYLE.LOON) && width >= 10 && bg;\n\tif (painted) {';
const SHELL_PROMPT_2_ANCHOR = '\treturn { width, nativeWidth: Math.max(1, width - (background ? 5 : 2)), prefixWidth: background ? 3 : 1, background };';
const SHELL_PROMPT_2_REPLACEMENT = '\t// float spends one column on a margin and two on the right edge; loon takes one on the\n\t// left, both on the right, and puts its rule inside the surface so the text column and\n\t// the right edge stay where the block has them.\n\tconst loon = style === CARD_STYLE.LOON;\n\tconst chrome = loon ? "loon" : "float";\n\tconst margin = loon ? 4 : 5;\n\treturn { width, nativeWidth: Math.max(1, width - (background ? margin : 2)), prefixWidth: background ? (loon ? 2 : 3) : 1, background, chrome };';
const SHELL_PROMPT_3_ANCHOR = 'export interface PromptLayout {\n\twidth: number;\n\tnativeWidth: number;\n\tprefixWidth: number;\n\tbackground: string;\n}';
const SHELL_PROMPT_3_REPLACEMENT = 'export interface PromptLayout {\n\twidth: number;\n\tnativeWidth: number;\n\tprefixWidth: number;\n\tbackground: string;\n\t/** Which painted chrome drew this row: float\'s margin, or loon\'s flush rule. */\n\tchrome?: "float" | "loon";\n}';
const SHELL_PROMPT_4_ANCHOR = '\tconst clipped = truncateToWidth(line, layout.nativeWidth, "");\n\tconst content = borderColor("▎") + " " + clipped + " ".repeat(Math.max(0, layout.nativeWidth - visibleWidth(clipped))) + " ";\n\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m ";';
const SHELL_PROMPT_4_REPLACEMENT = '\tconst clipped = truncateToWidth(line, layout.nativeWidth, "");\n\tconst padding = " ".repeat(Math.max(0, layout.nativeWidth - visibleWidth(clipped)));\n\tif (layout.chrome === "loon") {\n\t\t// The rule lives INSIDE the surface: column 0 is a plain margin, and the glyph is the\n\t\t// first painted cell. The rule is a quarter block, so a cell carrying no background\n\t\t// leaves a dark hole around it - the rule floats, brighter than the band it guards.\n\t\t// The row still starts with a bare space, for the same reason the float row does: a\n\t\t// row whose first cell is an escape loses its ESC when the prompt editor trims that\n\t\t// cell. The glyph takes a theme role, never the terminal default colour, so it cannot\n\t\t// outshine the band. Text keeps column 2 and the surface closes on the last column,\n\t\t// where the bar closes its own.\n\t\tconst content = borderColor("▎") + clipped + padding + "  ";\n\t\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m";\n\t}\n\tconst content = borderColor("▎") + " " + clipped + padding + " ";\n\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m ";';
const SHELL_PROMPT_5_ANCHOR = '\tif (layout.background && lines.length >= 2) {\n\t\treturn [\n\t\t\tfloatPromptRow(floatPromptHint(lines[0], lines[lines.length - 1], options, layout.nativeWidth).slice(2), layout, options.borderColor),\n\t\t\t...lines.slice(1, -1).map((line) => floatPromptRow(line, layout, options.borderColor)),\n\t\t\tfloatPromptRow("", layout, options.borderColor),\n\t\t];\n\t}\n';
const SHELL_PROMPT_5_REPLACEMENT = '\tif (layout.background && lines.length >= 2) {\n\t\tconst hint = floatPromptHint(lines[0], lines[lines.length - 1], options, layout.nativeWidth).slice(2);\n\t\t// Row 0 is the band\'s top slot, not a content row: pi\'s editor maps that row to its\n\t\t// padding, ignores it for clicks, and counts the rows below it as content before the\n\t\t// autocomplete zone. The loon label therefore carries NO surface and no rule - it is a\n\t\t// caption on the terminal background - and the band\'s surface starts on the first\n\t\t// content row. Painting the label as a band row is what put the surface on the label\n\t\t// itself, so the band looked like it opened on its own text. The label is padded to the\n\t\t// band\'s width, so both blocks end on the same column and the row count stays native:\n\t\t// top slot, content, closing row.\n\t\tconst label = " " + hint + " ".repeat(Math.max(0, layout.nativeWidth + 3 - visibleWidth(hint)));\n\t\treturn [\n\t\t\tlayout.chrome === "loon" ? label : floatPromptRow("", layout, options.borderColor),\n\t\t\t...(layout.chrome === "loon" ? [] : [floatPromptRow(hint, layout, options.borderColor)]),\n\t\t\t...lines.slice(1, -1).map((line) => floatPromptRow(line, layout, options.borderColor)),\n\t\t\tfloatPromptRow("", layout, options.borderColor),\n\t\t];\n\t}\n';
const SHELL_MOUSE_ANCHOR = '\thandleMouse(event: Parameters<CustomEditor["handleMouse"]>[0]): ReturnType<CustomEditor["handleMouse"]> {\n\t\tconst layout = this.floatMouseLayout;\n\t\tif (!layout) return super.handleMouse(event);\n\t\t// Row coordinates stay native: padding=0, content=1…N, hint=N+1.\n\t\t// Only float translates x; the existing neon/fallback path is unchanged.\n\t\tif (event.x < layout.prefixWidth || event.x >= layout.width - 1) return undefined;\n\t\treturn super.handleMouse({ ...event, x: event.x - layout.prefixWidth, width: layout.nativeWidth });\n\t}\n';
const SHELL_MOUSE_REPLACEMENT = '\thandleMouse(event: Parameters<CustomEditor["handleMouse"]>[0]): ReturnType<CustomEditor["handleMouse"]> {\n\t\tconst layout = this.floatMouseLayout;\n\t\tif (!layout) return super.handleMouse(event);\n\t\t// pi row model: padding=0, content=1…N, hint=N+1. A loon band fills it exactly - row 0\n\t\t// is its label slot, which pi ignores - so loon\'s rows are already native and nothing\n\t\t// is subtracted. Float still opens with a padding row of its own, so its rows sit one\n\t\t// lower and lose that one here. Only float translates; neon/fallback is untouched.\n\t\tconst shift = layout.chrome === "loon" ? 0 : 1;\n\t\tif (event.x < layout.prefixWidth || event.x >= layout.width - 1) return undefined;\n\t\treturn super.handleMouse({ ...event, x: event.x - layout.prefixWidth, y: event.y - shift, width: layout.nativeWidth });\n\t}\n';

// The third Card style row needs its own preview line, or the menu prints an
// undefined sample for it.
const SHELL_CARD_PREVIEW_ANCHOR = '\t\t\tconst cardStylePreview = { [CARD_STYLE.NEON]: "╭─ ✿ read ─╮  outlined chrome + prompt", [CARD_STYLE.FLOAT]: "▎ ✿ read  painted chrome + prompt" };';
const SHELL_CARD_PREVIEW_REPLACEMENT = '\t\t\tconst cardStylePreview = { [CARD_STYLE.NEON]: "╭─ ✿ read ─╮  outlined chrome + prompt", [CARD_STYLE.FLOAT]: "▎ ✿ read  painted chrome + prompt", [CARD_STYLE.LOON]: "▎ ✿ read  flush rule, text at column 2, two columns of air" };';

export const ANCHORS = {
	shellInit: SHELL_INIT_ANCHOR,
	shellRows: SHELL_ROWS_ANCHOR,
	shellCardPreview: SHELL_CARD_PREVIEW_ANCHOR,
	bannerConfig: BANNER_CONFIG_ANCHOR,
	bannerEvent: BANNER_EVENT_ANCHOR,
	viewLabelType: VIEW_LABEL_TYPE_ANCHOR,
	viewLabelCall: VIEW_LABEL_CALL_ANCHOR,
	shellBarBrand: SHELL_BAR_BRAND_ANCHOR,
	shellBarMinimal: SHELL_BAR_MINIMAL_ANCHOR,
	shellBarStages: SHELL_BAR_STAGES_ANCHOR,
	shellBarStagesTail: SHELL_BAR_STAGES_TAIL_ANCHOR,
	shellBarCallsite: SHELL_BAR_CALLSITE_ANCHOR,
	shellBarFallback: SHELL_BAR_FALLBACK_ANCHOR,
	shellBarUsage: SHELL_BAR_USAGE_ANCHOR,
	shellBarMarginImport: SHELL_BAR_MARGIN_IMPORT_ANCHOR,
	shellBarMarginRow: SHELL_BAR_MARGIN_ROW_ANCHOR,
	shellBarMarginPadding: SHELL_BAR_MARGIN_PADDING_ANCHOR,
	shellBarMarginRule: SHELL_BAR_MARGIN_RULE_ANCHOR,
	shellcard1: SHELL_CARD_1_ANCHOR,
	shellcard2: SHELL_CARD_2_ANCHOR,
	shellcard3: SHELL_CARD_3_ANCHOR,
	shellcard4: SHELL_CARD_4_ANCHOR,
	shellcard5: SHELL_CARD_5_ANCHOR,
	shellcard6: SHELL_CARD_6_ANCHOR,
	shellcard7: SHELL_CARD_7_ANCHOR,
	cardstylepolicy1: CARD_STYLE_POLICY_1_ANCHOR,
	shellprompt1: SHELL_PROMPT_1_ANCHOR,
	shellprompt2: SHELL_PROMPT_2_ANCHOR,
	shellprompt3: SHELL_PROMPT_3_ANCHOR,
	shellprompt4: SHELL_PROMPT_4_ANCHOR,
	shellprompt5: SHELL_PROMPT_5_ANCHOR,
	shellMouse: SHELL_MOUSE_ANCHOR,

};

export const TARGETS: TargetSpec[] = [
	{
		file: 'extensions/gentle-shell.ts',
		md5: 'ad1bfce79b655fc4f7cae71449d05d88',
		// Newest first: the patch before the mark row, the patch before the theme accent,
		// then the older patched states from before the v2 rows.
		md5PatchedV1: [
			'7da141c898257cf56230f735fe4c553e',
			'b12919486a662d03f1587ee719d0bd73',
			'f389ce976bc0a92e65b5d2f9e9b5dd3d',
			'24763fed19449f3a4e31a52bbe1be72e',
			'8ae96c97de14436e9755608a81579441',
			'b808107af050aa1778410fefa67974df',
			'945363c38d21403cce653143e0305a6a',
		],
		md5Patched: 'ec03598026098aefe27e1cd4dcfe7393',
		v2Marker: 'Banner color: wallpaper',
		edits: [
			{ anchor: SHELL_INIT_ANCHOR, replacement: SHELL_INIT_ANCHOR + '\n' + SHELL_INIT_ADDITION },
			{ anchor: SHELL_ROWS_ANCHOR, replacement: SHELL_ROWS_REPLACEMENT },
			{ anchor: SHELL_CARD_PREVIEW_ANCHOR, replacement: SHELL_CARD_PREVIEW_REPLACEMENT },
			{ anchor: SHELL_MOUSE_ANCHOR, replacement: SHELL_MOUSE_REPLACEMENT },
		],
	},
	{
		// The view calls a row's label with the width the row actually has, so a long
		// label can choose a shorter wording instead of being cut mid-word.
		file: 'lib/visual-customize-view.ts',
		md5: '6f1b71a9aa898fcf55196d73634b0076',
		md5Patched: '23bb9997b474842fe5f2a4d652c4178b',
		edits: [
			{ anchor: VIEW_LABEL_TYPE_ANCHOR, replacement: VIEW_LABEL_TYPE_REPLACEMENT },
			{ anchor: VIEW_LABEL_CALL_ANCHOR, replacement: VIEW_LABEL_CALL_REPLACEMENT },
		],
	},
	{
		file: 'extensions/startup-banner.ts',
		md5: '028bd98910468c7076ef31c65f36e09f',
		// Its patched bytes are the same in both versions: the guard did not change.
		md5Patched: '79167d2ce9c12de796f7c751778d0b18',
		edits: [
			{ anchor: BANNER_EVENT_ANCHOR, replacement: BANNER_EVENT_REPLACEMENT },
			{ anchor: BANNER_CONFIG_ANCHOR, replacement: BANNER_CONFIG_ANCHOR + '\n' + BANNER_CONFIG_ADDITION },
		],
	},
	{
		// The header bar's brand: a theme LOON generated says so in its name, and the
		// brand gives way to it. Stock themes keep the bar exactly as it was.
		file: 'lib/shell-bar.ts',
		md5: 'c5b3819241a587f960834409312a72a0',
		md5Patched: '5b43e3127eae0024d45b21eec34b1a95',
		md5PatchedV1: ['36afe7b323c27f7c2753a22d08cb57fa', 'c4392741927c8da26d0b9d24142e3a41'],
		edits: [
			{ anchor: SHELL_BAR_BRAND_ANCHOR, replacement: SHELL_BAR_BRAND_ANCHOR + '\n\n' + SHELL_BAR_BRAND_ADDITION },
			{ anchor: SHELL_BAR_MINIMAL_ANCHOR, replacement: SHELL_BAR_MINIMAL_REPLACEMENT },
			{ anchor: SHELL_BAR_STAGES_ANCHOR, replacement: SHELL_BAR_STAGES_REPLACEMENT },
			{ anchor: SHELL_BAR_STAGES_TAIL_ANCHOR, replacement: SHELL_BAR_STAGES_TAIL_REPLACEMENT },
			{ anchor: SHELL_BAR_CALLSITE_ANCHOR, replacement: SHELL_BAR_CALLSITE_REPLACEMENT },
			{ anchor: SHELL_BAR_FALLBACK_ANCHOR, replacement: SHELL_BAR_FALLBACK_REPLACEMENT },
			{ anchor: SHELL_BAR_USAGE_ANCHOR, replacement: SHELL_BAR_USAGE_REPLACEMENT },
			{ anchor: SHELL_BAR_MARGIN_IMPORT_ANCHOR, replacement: SHELL_BAR_MARGIN_IMPORT_REPLACEMENT },
			{ anchor: SHELL_BAR_MARGIN_ROW_ANCHOR, replacement: SHELL_BAR_MARGIN_ROW_REPLACEMENT },
			{ anchor: SHELL_BAR_MARGIN_PADDING_ANCHOR, replacement: SHELL_BAR_MARGIN_PADDING_REPLACEMENT },
			{ anchor: SHELL_BAR_MARGIN_RULE_ANCHOR, replacement: SHELL_BAR_MARGIN_RULE_REPLACEMENT },
		],
	},
	{
		// Card style loon: lib/shell-card.ts
		file: 'lib/shell-card.ts',
		md5: 'd189f85262f41f5a5e8f590a0c57ed2d',
		md5Patched: '8f3460ef6d3a5222d7a26662bb46b642',
		md5PatchedV1: ['8dbecc2f2ac057b87ce5c344d7ba5241'],
		edits: [
			{ anchor: SHELL_CARD_1_ANCHOR, replacement: SHELL_CARD_1_REPLACEMENT },
			{ anchor: SHELL_CARD_2_ANCHOR, replacement: SHELL_CARD_2_REPLACEMENT },
			{ anchor: SHELL_CARD_3_ANCHOR, replacement: SHELL_CARD_3_REPLACEMENT },
			{ anchor: SHELL_CARD_4_ANCHOR, replacement: SHELL_CARD_4_REPLACEMENT },
			{ anchor: SHELL_CARD_5_ANCHOR, replacement: SHELL_CARD_5_REPLACEMENT },
			{ anchor: SHELL_CARD_6_ANCHOR, replacement: SHELL_CARD_6_REPLACEMENT },
			{ anchor: SHELL_CARD_7_ANCHOR, replacement: SHELL_CARD_7_REPLACEMENT },
		],
	},
	{
		// Card style loon: lib/card-style-policy.ts
		file: 'lib/card-style-policy.ts',
		md5: '2833f69f68273d351a09fd1d39424756',
		md5Patched: '874f4ca140cf3c951af7f3403a57b4ee',
		edits: [
			{ anchor: CARD_STYLE_POLICY_1_ANCHOR, replacement: CARD_STYLE_POLICY_1_REPLACEMENT },
		],
	},
	{
		// Card style loon: lib/shell-prompt.ts
		file: 'lib/shell-prompt.ts',
		md5: '6dccc1c4bf36e217d308a67c5e690c14',
		md5Patched: 'fa3cc52522ee55195f48ceeee9c47259',
		md5PatchedV1: ['08885475062712796843ef9508f6b1ed', '993a7f2237db3eb718b9d6ab05591bf1', '040c2b8c8ca1f727aa937ca6e5204375', '0618298301450ad9811a4d7b287bc3cd', '2174a62f342df42f37d2a78b53b2a9e0', '6ed83675ab5a63201df8ea38867cee8d', '5bd10c1347200edb2f181e7631e67b52', '0d07a750ae6162d2c8bbfbda7760e55f', '4e357af84fcafc01f3e240ea6331b066', 'ddb8bd748ae664cb28f9f0307e0917e5'],
		edits: [
			{ anchor: SHELL_PROMPT_1_ANCHOR, replacement: SHELL_PROMPT_1_REPLACEMENT },
			{ anchor: SHELL_PROMPT_2_ANCHOR, replacement: SHELL_PROMPT_2_REPLACEMENT },
			{ anchor: SHELL_PROMPT_3_ANCHOR, replacement: SHELL_PROMPT_3_REPLACEMENT },
			{ anchor: SHELL_PROMPT_4_ANCHOR, replacement: SHELL_PROMPT_4_REPLACEMENT },
			{ anchor: SHELL_PROMPT_5_ANCHOR, replacement: SHELL_PROMPT_5_REPLACEMENT },
		],
	},
];

export function md5(text: string): string {
	return createHash('md5').update(text).digest('hex');
}

export type PatchState = 'missing' | 'patched' | 'patched-v1' | 'clean' | 'different-version';

/**
 * True when every anchor of the target occurs exactly once: the only condition the
 * patch actually needs. A gentle-pi update that misses every anchor is patchable, and
 * one that touches an anchor is not, whatever the file's digest says.
 */
export function anchorsResolve(text: string, spec: TargetSpec): boolean {
	return spec.edits.every((edit) => text.split(edit.anchor).length - 1 === 1);
}

/**
 * What the file in front of us is. The digest is a diagnosis and a backup datum, never
 * a permission: gating on it refused to patch a build whose anchors were untouched,
 * which is the opposite of what a patch that must break loudly is for.
 */
export function classify(text: string | undefined, spec: TargetSpec): PatchState {
	if (text === undefined) return 'missing';
	const digest = md5(text);
	if (spec.md5Patched !== undefined && digest === spec.md5Patched) return 'patched';
	if (spec.md5PatchedV1 !== undefined && spec.md5PatchedV1.includes(digest)) return 'patched-v1';
	return anchorsResolve(text, spec) ? 'clean' : 'different-version';
}



/** True when the file carries our marker, so a refusal can say what happened. */
export function isMarked(text: string | undefined, spec: TargetSpec): boolean {
	return text !== undefined && text.includes(PATCH_MARKER) && (spec.v2Marker === undefined || text.includes(spec.v2Marker));
}

export type PatchResult = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

/** Apply every edit of one target to its text. Idempotent and anchor-checked. */
/**
 * The promise the patch makes, checked on its own output: every replacement landed
 * exactly once. An anchor that resolves is not enough if the result does not contain what
 * it was supposed to write.
 */
export function verifyPatched(text: string, spec: TargetSpec): string | undefined {
	// No marker check: not every target's replacement carries it, and the promise that
	// matters is the substitutions themselves.
	for (const edit of spec.edits) {
		const occurrences = text.split(edit.replacement).length - 1;
		if (occurrences !== 1) {
			return 'a replacement landed ' + occurrences + ' time(s) in ' + spec.file + ', expected 1';
		}
	}
	return undefined;
}

export function patchText(text: string, spec: TargetSpec): PatchResult {
	if (text.includes(PATCH_MARKER)) return { ok: true, text, changed: false };

	let next = text;
	for (const edit of spec.edits) {
		const occurrences = next.split(edit.anchor).length - 1;
		if (occurrences !== 1) {
			return { ok: false, reason: 'anchor for ' + spec.file + ' appears ' + occurrences + ' time(s), expected exactly 1' };
		}
		next = next.replace(edit.anchor, () => edit.replacement);
	}
	return { ok: true, text: next, changed: next !== text };
}

/** Every anchor present exactly once: the file is the build this patch knows. */
export function anchorsFit(text: string, spec: TargetSpec): boolean {
	return spec.edits.every((edit) => text.split(edit.anchor).length - 1 === 1);
}

export interface PatchPaths {
	install: string;
	backups: string;
}

export function defaultPaths(): PatchPaths {
	return {
		install: join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
		backups: join(homedir(), '.pi', 'agent', 'backups'),
	};
}

/** The version the installed package reports, or undefined when it cannot be read. */
export function installedVersion(install: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(install, 'package.json'), 'utf8'));
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const version = (parsed as { version?: unknown }).version;
		return typeof version === 'string' ? version : undefined;
	} catch {
		return undefined;
	}
}

/**
 * An anchor as this file writes it. Both quote styles are tried, because the anchors
 * are not written in one: escaping only the double-quoted form left half the targets
 * with no address at all.
 */
function literalForms(text: string): string[] {
	const base = text.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
	return [base.replace(/"/g, '\\"'), base.replace(/'/g, "\\'")];
}

/**
 * Where an anchor lives in this script, so a refusal is an address to jump to and not
 * a hint to go hunting: `scripts/gentle-pi-patch.ts:61 (shellInit)`.
 *
 * The name comes from ANCHORS, and that entry names the constant that holds the text,
 * which is the only way to find an anchor written as an array of lines: its text is
 * never one literal in this file, and searching for it finds nothing.
 */
export function anchorAddress(anchor: string): string | undefined {
	try {
		const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
		const name = Object.entries(ANCHORS).find(([, value]) => value === anchor)?.[0];
		if (name === undefined) {
			const index = literalForms(anchor)
				.map((form) => source.indexOf(form))
				.find((found) => found >= 0);
			if (index === undefined || index < 0) return undefined;
			return 'scripts/gentle-pi-patch.ts:' + source.slice(0, index).split('\n').length;
		}
		const entry = new RegExp('^\\t' + name + ': ([A-Za-z0-9_]+),', 'm').exec(source);
		const constant = entry?.[1];
		const at = constant === undefined ? -1 : source.indexOf('const ' + constant + ' =');
		if (at < 0) return undefined;
		return 'scripts/gentle-pi-patch.ts:' + source.slice(0, at).split('\n').length + ' (' + name + ')';
	} catch {
		return undefined;
	}
}

/** One anchor that no longer matches, with the closest line the target still has. */
export interface AnchorProblem {
	anchor: string;
	occurrences: number;
	address: string | undefined;
	/** The anchor's first line, which is what a person compares against the target. */
	expected: string;
	/** The target's own line that most resembles it, already prefixed with its number. */
	found: string | undefined;
}

const firstLine = (text: string): string => {
	const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 8);
	const line = lines[0] ?? text.replace(/\s+/g, ' ').trim();
	return line.slice(0, 120);
};

/**
 * The target's line that most resembles the anchor: the one carrying the anchor's
 * longest identifier. A diff would be better and would say more; this says where to
 * look, which is what a refused patch owes the person fixing it.
 */
function closestLine(text: string, anchor: string): string | undefined {
	const identifiers = (anchor.match(/[A-Za-z_][A-Za-z0-9_]{6,}/g) ?? []).sort((a, b) => b.length - a.length);
	if (identifiers.length === 0) return undefined;
	const lines = text.split('\n');
	for (const identifier of identifiers) {
		const index = lines.findIndex((line) => line.includes(identifier));
		if (index >= 0) return 'line ' + (index + 1) + ': ' + (lines[index] ?? '').trim().slice(0, 120);
	}
	return undefined;
}

/** Which anchors of one target stopped matching, and where each of them lives. */
export function diagnoseAnchors(text: string, spec: TargetSpec): AnchorProblem[] {
	const problems: AnchorProblem[] = [];
	for (const edit of spec.edits) {
		const occurrences = text.split(edit.anchor).length - 1;
		if (occurrences === 1) continue;
		problems.push({
			anchor: edit.anchor,
			occurrences,
			address: anchorAddress(edit.anchor),
			expected: firstLine(edit.anchor),
			found: closestLine(text, edit.anchor),
		});
	}
	return problems;
}

/**
 * Why a target was refused, in full: which file, how its bytes differ, which anchors
 * stopped matching, where each anchor lives in this script, and what was not done.
 * Only called when an anchor does not resolve - a healthy anchor set is patchable, so
 * there is no refusal to explain.
 */
function reportDrift(spec: TargetSpec, text: string | undefined, paths: PatchPaths): void {
	console.error(spec.file + ': not the build this patch was written against');
	console.error('  md5:      expected ' + spec.md5 + ', found ' + (text === undefined ? '(no file)' : md5(text)));
	console.error('  version:  installed ' + (installedVersion(paths.install) ?? 'unknown') + ' · patch pinned to ' + GENTLE_PI_VERSION);
	const problems = diagnoseAnchors(text ?? '', spec);
	for (const problem of problems) {
		console.error('  anchor:   ' + (problem.address ?? 'scripts/gentle-pi-patch.ts (line not found)') + ' occurs ' + problem.occurrences + ' time(s), expected 1');
		console.error('    expected: ' + problem.expected);
		console.error('    found:    ' + (problem.found ?? 'no similar line in ' + spec.file));
	}
	console.error('  nothing was written: no file changed and no backup was created');
}

function readTarget(spec: TargetSpec, paths: PatchPaths): string | undefined {
	try {
		return readFileSync(join(paths.install, spec.file), 'utf8');
	} catch {
		return undefined;
	}
}

/** The jiti entry pi itself loads extensions with, or undefined when not found. */
export function findPiInstall(paths: PatchPaths = defaultPaths()): string | undefined {
	const roots = [
		process.env.PI_NPM_PREFIX ? join(process.env.PI_NPM_PREFIX, 'lib', 'node_modules') : undefined,
		join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules'),
		join(dirname(process.execPath), '..', 'lib', 'node_modules'),
		join(paths.install, '..'),
	].filter((root): root is string => root !== undefined);
	for (const root of roots) {
		const candidate = join(root, '@earendil-works', 'pi-coding-agent');
		if (existsSync(join(candidate, 'package.json'))) return candidate;
	}
	return undefined;
}

/** The jiti entry inside a pi install, the loader pi itself loads extensions with. */
export function jitiEntry(piRoot: string): string {
	return join(piRoot, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs');
}

/**
 * The module aliases pi hands to jiti, so an extension that imports
 * `@earendil-works/pi-coding-agent` resolves here exactly as it does at runtime.
 * Those packages are not installed next to gentle-pi; pi injects them.
 */
export function buildAliases(piRoot: string): Record<string, string> {
	const nested = join(piRoot, 'node_modules', '@earendil-works');
	const candidate = (relative: string): string | undefined => {
		const path = join(nested, relative);
		return existsSync(path) ? path : undefined;
	};
	const agentCore = candidate(join('pi-agent-core', 'dist', 'index.js'));
	const tui = candidate(join('pi-tui', 'dist', 'index.js'));
	const ai = candidate(join('pi-ai', 'dist'));
	const piIndex = join(piRoot, 'dist', 'index.js');
	const aliases: Record<string, string> = {};
	const add = (specifier: string, path: string | undefined): void => {
		if (path !== undefined) aliases[specifier] = path;
	};

	for (const prefix of ['@earendil-works', '@mariozechner']) {
		add(prefix + '/pi-coding-agent', piIndex);
		add(prefix + '/pi-agent-core', agentCore);
		add(prefix + '/pi-tui', tui);
		add(prefix + '/pi-ai', ai === undefined ? undefined : join(ai, 'compat.js'));
		add(prefix + '/pi-ai/compat', ai === undefined ? undefined : join(ai, 'compat.js'));
		add(prefix + '/pi-ai/oauth', ai === undefined ? undefined : join(ai, 'oauth.js'));
		add(prefix + '/pi-ai/models', ai === undefined ? undefined : join(ai, 'models.js'));
		add(prefix + '/pi-ai/providers/all', ai === undefined ? undefined : join(ai, 'providers', 'all.js'));
	}

	const piRequire = createRequire(join(piRoot, 'package.json'));
	for (const specifier of ['typebox', 'typebox/compile', 'typebox/value', '@sinclair/typebox', '@sinclair/typebox/compile', '@sinclair/typebox/value']) {
		try {
			add(specifier, piRequire.resolve(specifier));
		} catch {
			// Not installed beside pi: nothing to alias.
		}
	}
	return aliases;
}

const VALIDATOR_SOURCE = "const fs = await import('node:fs');\nconst [entry, aliasesPath, target] = process.argv.slice(2);\nconst aliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));\nlet createJiti;\nif (entry) {\n  const mod = await import(entry);\n  createJiti = mod.createJiti ?? mod.default?.createJiti;\n}\nconst loaded = typeof createJiti === 'function'\n  ? await createJiti(import.meta.url, { moduleCache: false, interopDefault: true, fsCache: false, alias: aliases }).import(target)\n  : await import(target);\n// A pi extension exports a factory; a library module exports names. Either way the\n// module parsed and evaluated, which is what this gate is for.\nif (loaded === undefined || loaded === null) throw new Error('module did not load');\nif ('default' in loaded && typeof loaded.default !== 'function' && Object.keys(loaded).length === 1) {\n  throw new Error('module default export is not a function');\n}\nif (Object.keys(loaded).length === 0) throw new Error('module exports nothing');\nconsole.log('ok');";

/** Import a file in a child process, the way pi loads extensions. */
export function validateImport(
	targetPath: string,
	jiti: { entry: string; aliases: Record<string, string> } | undefined,
): { ok: boolean; detail: string } {
	const dir = join(tmpdir(), 'loon-patch-validate-' + process.pid);
	mkdirSync(dir, { recursive: true });
	const script = join(dir, 'validate.mjs');
	const aliasesPath = join(dir, 'aliases.json');
	try {
		writeFileSync(script, VALIDATOR_SOURCE);
		writeFileSync(aliasesPath, JSON.stringify(jiti?.aliases ?? {}));
		const output = execFileSync(process.execPath, ['--experimental-strip-types', script, jiti?.entry ?? '', aliasesPath, targetPath], {
			encoding: 'utf8',
			timeout: 120_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { ok: output.trim().endsWith('ok'), detail: jiti ? 'jiti' : 'node strip-types' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, detail: message.split('\n').slice(0, 8).join('\n') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function timestamp(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
}

/** The backup a plan can trust: its bytes must be the ones its own record says were there. */
function trustedBackup(paths: PatchPaths, spec: TargetSpec): { dir: string; text: string; patched: string | undefined } | undefined {
	for (const dir of backupDirs(paths)) {
		const path = join(paths.backups, dir, spec.file);
		if (!existsSync(path)) continue;
		let files: unknown;
		try {
			files = (JSON.parse(readFileSync(join(paths.backups, dir, 'manifest.json'), 'utf8')) as { files?: unknown }).files;
		} catch {
			continue;
		}
		if (!Array.isArray(files)) continue;
		const entry = files.find((item) => (item as { file?: unknown }).file === spec.file) as
			| { md5?: unknown; patchedMd5?: unknown }
			| undefined;
		if (typeof entry?.md5 !== 'string') continue;
		const text = readFileSync(path, 'utf8');
		if (md5(text) !== entry.md5) continue;
		return { dir, text, patched: typeof entry.patchedMd5 === 'string' ? entry.patchedMd5 : undefined };
	}
	return undefined;
}

function backupOriginals(
	paths: PatchPaths,
	specs: { spec: TargetSpec; text: string; patched: string }[],
): string {
	// Two runs inside the same second must not share a directory: the second could
	// mix its copies with the first one's.
	const base = 'gentle-pi-banner-patch-' + timestamp();
	let dir = join(paths.backups, base);
	for (let copy = 2; existsSync(dir); copy += 1) dir = join(paths.backups, base + '-' + copy);
	for (const { spec, text } of specs) {
		const target = join(dir, spec.file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, text);
	}
	const manifest = {
		version: GENTLE_PI_VERSION,
		at: new Date().toISOString(),
		files: specs.map(({ spec, text, patched }) => ({
			file: spec.file,
			// The file that was there, which is what revert gives back.
			md5: md5(text),
			// And the file this run wrote, which is what revert verifies before it does.
			patchedMd5: md5(patched),
		})),
	};
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	return dir;
}

function writeAtomically(path: string, text: string): void {
	const temporary = path + '.' + process.pid + '.tmp';
	writeFileSync(temporary, text);
	renameSync(temporary, path);
}

export function report(paths: PatchPaths, targets: TargetSpec[] = TARGETS): number {
	const installed = installedVersion(paths.install);
	console.log('gentle-pi installed: ' + (installed ?? 'unknown') + ' · patch pinned to ' + GENTLE_PI_VERSION);
	if (installed !== GENTLE_PI_VERSION) {
		console.log('  not the build this patch was written against: the anchors decide, and each target below says whether they still resolve');
	}
	for (const spec of targets) {
		const text = readTarget(spec, paths);
		const state = classify(text, spec);
		const extra =
			state === 'different-version'
				? ' (md5 ' + md5(text ?? '') + ', expected ' + spec.md5 + ')'
				: state === 'clean' && md5(text ?? '') !== spec.md5
					? ' (anchors intact: ' + spec.edits.length + ' checked; md5 ' + md5(text ?? '') + ' is not the pinned ' + spec.md5 + ', so the build is untested)'
					: '';
		console.log(spec.file + ': ' + state + extra);
		if (state !== 'different-version') continue;
		for (const problem of diagnoseAnchors(text ?? '', spec)) {
			console.log('  ' + (problem.address ?? 'anchor at an unknown line') + ': occurs ' + problem.occurrences + ' time(s), expected 1');
			console.log('    expected: ' + problem.expected);
			console.log('    found:    ' + (problem.found ?? 'no similar line'));
		}
	}
	return 0;
}

export function apply(paths: PatchPaths, targets: TargetSpec[] = TARGETS): number {
	const prepared: { spec: TargetSpec; pristine: string; patched: string }[] = [];

	for (const spec of targets) {
		const text = readTarget(spec, paths);
		const state = classify(text, spec);
		if (state === 'missing') {
			console.error(spec.file + ': not found under ' + paths.install + '; nothing was changed');
			return 1;
		}
		if (state === 'patched') {
			console.log(spec.file + ': already patched, skipping');
			continue;
		}
		if (state === 'different-version') {
			reportDrift(spec, text, paths);
			if (isMarked(text, spec)) {
				console.error('  marker:   this file carries the patch marker and was edited after patching; revert or reinstall gentle-pi ' + GENTLE_PI_VERSION + ' first');
			}
			return 2;
		}
		if (state === 'clean' && md5(text ?? '') !== spec.md5) {
			// The anchors are intact in a file this patch was not written against: patch it,
			// and say so rather than pretending the build is the tested one.
			console.log(spec.file + ': anchors intact on a build with md5 ' + md5(text ?? '') + ', pinned ' + spec.md5);
		}

		// A file we patched in an earlier version is upgraded from the pristine copy
		// recorded in its backup: patching over a patched file would nest anchors.
		let base = text ?? '';
		if (state === 'patched-v1') {
			const pristine = findPristineBackup(paths, spec);
			if (pristine === undefined) {
				console.error(spec.file + ': patched by an earlier version, and no verified pristine backup was found');
				console.error('reinstall gentle-pi ' + GENTLE_PI_VERSION + ' or restore the file by hand; nothing was changed');
				return 2;
			}
			console.log(spec.file + ': upgrading over the recorded pristine copy');
			base = pristine;
		}

		const result = patchText(base, spec);
		if (!result.ok) {
			console.error(spec.file + ': ' + result.reason + '; nothing was changed');
			return 2;
		}
		const promise = verifyPatched(result.text, spec);
		if (promise !== undefined) {
			console.error(spec.file + ': ' + promise + '; nothing was changed');
			return 2;
		}
		prepared.push({ spec, pristine: base, patched: result.text });
	}

	if (prepared.length === 0) {
		console.log('already patched');
		return 0;
	}

	const installed = installedVersion(paths.install);
	if (installed !== GENTLE_PI_VERSION) {
		const anchors = prepared.reduce((total, item) => total + item.spec.edits.length, 0);
		console.log(
			'gentle-pi ' + (installed ?? 'unknown') + ': ' + anchors + ' anchors intact, version not tested (this patch was written against ' + GENTLE_PI_VERSION + ')',
		);
	}

	const piRoot = findPiInstall(paths);
	const jiti = piRoot === undefined ? undefined : { entry: jitiEntry(piRoot), aliases: buildAliases(piRoot) };
	for (const { spec, pristine, patched } of prepared) {
		const original = join(paths.install, spec.file);
		const probe = original + '.' + process.pid + '.loon-patch.tmp.ts';
		// The baseline is the pristine copy this version will build on: if the loader
		// cannot import that, a validation of the patched output would prove nothing.
		const baselineProbe = original + '.' + process.pid + '.loon-baseline.tmp.ts';
		try {
			writeFileSync(baselineProbe, pristine);
			const baseline = validateImport(baselineProbe, jiti);
			if (!baseline.ok) {
				console.error(spec.file + ': the loader cannot import the untouched file, so a validation would prove nothing');
				console.error(baseline.detail);
				return 3;
			}
			writeFileSync(probe, patched);
			const check = validateImport(probe, jiti);
			if (!check.ok) {
				console.error(spec.file + ': the patched copy does not load; nothing was changed');
				console.error(check.detail);
				return 3;
			}
			console.log(spec.file + ': patched copy loads with ' + check.detail);
		} finally {
			rmSync(probe, { force: true });
			rmSync(baselineProbe, { force: true });
		}
	}

	// Every backup holds the pristine 4.5.1 bytes, so `revert` always has something
	// to verify against - including when this run upgraded our own earlier patch.
	const dir = backupOriginals(paths, prepared.map(({ spec, pristine, patched }) => ({ spec, text: pristine, patched })));
	console.log('backup: ' + dir);
	for (const { spec, patched } of prepared) {
		writeAtomically(join(paths.install, spec.file), patched);
		console.log(spec.file + ': patched');
	}
	return 0;
}
/**
 * The pristine file recorded by an earlier run, newest backup first. Needed to
 * upgrade over our own previous patch: the installed file is not the build.
 */
/** Every backup directory, newest first. */
function backupDirs(paths: PatchPaths): string[] {
	if (!existsSync(paths.backups)) return [];
	return readdirSync(paths.backups)
		.filter((name) => name.startsWith('gentle-pi-banner-patch-'))
		.sort()
		.reverse();
}

/**
 * The pristine copy of one target recorded by an earlier run, newest first.
 *
 * Resolution is per file, not per directory: a run that only had to patch one file
 * writes a backup with only that file, and another run covers the rest. Requiring one
 * directory to hold every target would find nothing even when the bytes exist.
 */
export function findPristineBackup(paths: PatchPaths, spec: TargetSpec): string | undefined {
	for (const dir of backupDirs(paths)) {
		const candidate = join(paths.backups, dir, spec.file);
		if (!existsSync(candidate)) continue;
		const text = readFileSync(candidate, 'utf8');
		if (md5(text) === spec.md5) return text;
	}
	return undefined;
}

export interface RestoreStep {
	spec: TargetSpec;
	/** Where the recorded bytes were found. */
	source: string;
	text: string;
	/** Digests of every output this patch would have written for the target. */
	ours: string[];
}

export type RestorePlan =
	| { ok: true; steps: RestoreStep[] }
	| { ok: false; missing: { file: string; expects: string[] }[] };

/** Every digest this patch may have written for a target, newest first. */
function ourOutputs(spec: TargetSpec): string[] {
	return [spec.md5Patched, ...(spec.md5PatchedV1 ?? [])].filter((value): value is string => typeof value === 'string');
}

/**
 * Resolve and verify every target before anything is written, so a missing or wrong
 * snapshot cannot leave the installation half restored.
 *
 * The recorded copy is used as it is: it holds whatever was installed before the patch,
 * which is the file to give back. The pinned digest of gentle-pi 4.5.1 is not the gate
 * here either - a build that was patched over a harmless change must revert to that
 * change, not to a release this machine never had.
 */
export function planRestore(paths: PatchPaths, targets: TargetSpec[] = TARGETS): RestorePlan {
	const steps: RestoreStep[] = [];
	const missing: { file: string; expects: string[] }[] = [];
	for (const spec of targets) {
		const backup = trustedBackup(paths, spec);
		if (backup === undefined) {
			missing.push({ file: spec.file, expects: ourOutputs(spec) });
			continue;
		}
		const ours = backup.patched === undefined ? ourOutputs(spec) : [backup.patched, ...ourOutputs(spec)];
		steps.push({ spec, source: join(paths.backups, backup.dir, spec.file), text: backup.text, ours });
	}
	return missing.length > 0 ? { ok: false, missing } : { ok: true, steps };
}

export function revert(paths: PatchPaths, targets: TargetSpec[] = TARGETS): number {
	const plan = planRestore(paths, targets);
	if (!plan.ok) {
		for (const item of plan.missing) {
			console.error(item.file + ': no recorded copy to restore from under ' + paths.backups);
		}
		console.error('nothing was restored');
		return 2;
	}

	// Before overwriting anything: what is installed has to be what this patch wrote.
	// Otherwise someone else changed the file, and restoring would destroy their work.
	for (const step of plan.steps) {
		const installed = md5(readTarget(step.spec, paths) ?? '');
		if (!step.ours.includes(installed)) {
			console.error(step.spec.file + ': the installed file is md5 ' + installed + ', not one this patch wrote');
			console.error('  expected one of: ' + step.ours.join(', '));
			console.error('something else changed it; nothing was restored');
			return 2;
		}
	}

	for (const step of plan.steps) {
		const target = join(paths.install, step.spec.file);
		writeAtomically(target, step.text);
		if (readFileSync(target, 'utf8') !== step.text) {
			console.error(step.spec.file + ': restore did not produce the recorded bytes');
			return 2;
		}
		console.log(step.spec.file + ': restored (' + md5(step.text) + ') from ' + step.source);
	}
	return 0;
}
export function latestBackup(paths: PatchPaths, targets: TargetSpec[] = TARGETS): string | undefined {
	if (!existsSync(paths.backups)) return undefined;
	const dirs = readdirSync(paths.backups)
		.filter((name) => name.startsWith('gentle-pi-banner-patch-'))
		.sort()
		.reverse();
	for (const name of dirs) {
		if (targets.every((spec) => existsSync(join(paths.backups, name, spec.file)))) return join(paths.backups, name);
	}
	return undefined;
}


export function main(argv: string[]): number {
	const paths = defaultPaths();
	// Test seams: a copy of the package and a scratch backup directory.
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--install' && argv[index + 1] !== undefined) paths.install = argv[index + 1] as string;
		if (argv[index] === '--backups' && argv[index + 1] !== undefined) paths.backups = argv[index + 1] as string;
	}
	const command = argv.find((value, index) => !value.startsWith('--') && argv[index - 1] !== '--install' && argv[index - 1] !== '--backups');
	if (command === 'check') return report(paths);
	if (command === 'apply') return apply(paths);
	if (command === 'revert') return revert(paths);
	console.error('usage: gentle-pi-patch.ts <check|apply|revert> [--install <gentle-pi dir>] [--backups <dir>]');
	return 64;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
	process.exitCode = main(process.argv.slice(2));
}
