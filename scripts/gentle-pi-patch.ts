#!/usr/bin/env node
/**
 * Patch gentle-pi's own customization menu so it offers LOON as a third banner
 * source, teach gentle-pi's banner to stay out of the way when LOON owns the slot,
 * and let the shell bar drop its brand under a theme LOON generated.
 *
 * This edits another installed package, so it is deliberately paranoid:
 *
 *   - the files must be exactly the gentle-pi 4.6.0 build the patch was written
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
export const GENTLE_PI_VERSION = '4.6.0';

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
	/** md5 of the untouched 4.6.0 build. */
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
const SHELL_INIT_ADDITION = "\t\t\t// LOON banner patch v2: the banner source and the accent choice live in\n\t\t\t// LOON's own settings file, because writeBannerConfig() persists only this\n\t\t\t// file's three keys and would drop anything else written here.\n\t\t\tconst loonSettingsPath = join(process.env.PI_CODING_AGENT_DIR || join(os.homedir(), \".pi\", \"agent\"), \"loon-tui.json\");\n\t\t\tconst readLoonSettings = async (): Promise<Record<string, unknown>> => {\n\t\t\t\ttry {\n\t\t\t\t\tconst parsed: unknown = JSON.parse(await readFile(loonSettingsPath, \"utf8\"));\n\t\t\t\t\treturn typeof parsed === \"object\" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};\n\t\t\t\t} catch {\n\t\t\t\t\treturn {};\n\t\t\t\t}\n\t\t\t};\n\t\t\tlet loonSettings = await readLoonSettings();\n\t\t\tlet loonBannerSource: \"loon\" | \"rose\" | \"off\" = loonSettings.source === \"rose\" || loonSettings.source === \"off\" ? loonSettings.source : \"loon\";\n\t\t\tconst writeLoonSettings = async (next: Record<string, unknown>) => {\n\t\t\t\tconst { mkdir, rename, writeFile } = await import(\"node:fs/promises\");\n\t\t\t\tawait mkdir(dirname(loonSettingsPath), { recursive: true });\n\t\t\t\tconst temporary = `${loonSettingsPath}.${process.pid}.tmp`;\n\t\t\t\tawait writeFile(temporary, `${JSON.stringify(next, null, \"\\t\")}\\n`, { mode: 0o600 });\n\t\t\t\tawait rename(temporary, loonSettingsPath);\n\t\t\t\tloonSettings = next;\n\t\t\t};\n\t\t\tconst saveLoonBannerSource = async (source: \"loon\" | \"rose\" | \"off\") => {\n\t\t\t\tawait writeLoonSettings({ ...loonSettings, source });\n\t\t\t\tloonBannerSource = source;\n\t\t\t};\n\t\t\tconst saveLoonAccent = async (accent: \"theme\" | \"banner\" | \"wallpaper\") => {\n\t\t\t\tawait writeLoonSettings({ ...loonSettings, accent });\n\t\t\t};\n\t\t\t// One rule for which colour is current: the accent decides, and the label and the\n\t\t\t// descriptor both read it from here. Two copies of that condition is how the menu\n\t\t\t// came to claim pink and wallpaper were current at the same time.\n\t\t\tconst loonBannerColorCurrent = (color: string) => (loonBannerSource !== \"loon\" || (loonSettings.accent !== \"theme\" && loonSettings.accent !== \"wallpaper\")) && banner.color === color;\n\t\t\tconst readWallpaperAccent = async (): Promise<{ hex: string; rgb: [number, number, number] } | undefined> => {\n\t\t\t\ttry {\n\t\t\t\t\tconst { readFile: readText } = await import(\"node:fs/promises\");\n\t\t\t\t\tconst home = process.env.HOME ?? os.homedir();\n\t\t\t\t\tconst raw = await readText(join(home, \".config\", \"mpvpaper\", \"accent.txt\"), \"utf8\");\n\t\t\t\t\tconst match = /^\\s*#?([0-9a-fA-F]{6})\\s*$/.exec(raw);\n\t\t\t\t\tif (match === null) return undefined;\n\t\t\t\t\tconst hex = match[1]!.toUpperCase();\n\t\t\t\t\treturn { hex: \"#\" + hex, rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] };\n\t\t\t\t} catch {\n\t\t\t\t\treturn undefined;\n\t\t\t\t}\n\t\t\t};\n\t\t\tlet loonWallpaperAccent = await readWallpaperAccent();";


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
// 4.6.0 moved the per-row repaint and the surface opener into shell-card, so the
// import this anchor pins grew. The patch needs the style and its geometry too.
const SHELL_BAR_MARGIN_IMPORT_ANCHOR = 'import { CARD_TONE, floatRows, paintSurfaceRow, panelInnerWidth, renderCard, surfaceOpener } from "./shell-card.ts";';
const SHELL_BAR_MARGIN_IMPORT_REPLACEMENT = 'import { CARD_STYLE, CARD_TONE, cardStyle, floatRows, paintSurfaceRow, panelInnerWidth, renderCard, surfaceOpener } from "./shell-card.ts";';

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
	'\t\t...(model.effort ? [[brand, withEffort]] : []),',
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
	'\t\t...(model.effort ? [withBrand([withEffort])] : []),',
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
// 4.6.0 moved the per-row repaint into paintSurfaceRow(); the geometry around it is ours.
const SHELL_CARD_4_ANCHOR = 'function paintFloat(rows: readonly string[], open: string): string[] {\n\tconst margin = " ".repeat(FLOAT_MARGIN);\n\treturn rows.map((row) => `${margin}${paintSurfaceRow(row, open)}${margin}`);\n}';
const SHELL_CARD_4_REPLACEMENT = 'function paintFloat(rows: readonly string[], open: string): string[] {\n\tconst geometry = cardGeometry();\n\tconst left = " ".repeat(geometry.padLeft);\n\tconst right = " ".repeat(geometry.padRight);\n\t// A painted row may not begin with an escape: the first cell has to be printable, or a\n\t// consumer that trims that cell takes the ESC with it and the terminal prints the\n\t// parameter. Every painted geometry therefore keeps padLeft >= 1, and the test asserts\n\t// it from the rendered bytes rather than from this comment.\n\treturn rows.map((row) => `${left}${paintSurfaceRow(row, open)}${right}`);\n}\n';
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
// 4.6.0 added the wide IDE panel: a titled rule and a '›' prompt, no frame.
const SHELL_PROMPT_3_ANCHOR = 'export interface PromptLayout {\n\twidth: number;\n\tnativeWidth: number;\n\tprefixWidth: number;\n\tbackground: string;\n\t/** The wide IDE chrome\'s editor: a titled rule and a `›` prompt, no frame. */\n\tpanel?: boolean;\n}';
const SHELL_PROMPT_3_REPLACEMENT = 'export interface PromptLayout {\n\twidth: number;\n\tnativeWidth: number;\n\tprefixWidth: number;\n\tbackground: string;\n\t/** The wide IDE chrome\'s editor: a titled rule and a `›` prompt, no frame. */\n\tpanel?: boolean;\n\t/** Which painted chrome drew this row: float\'s margin, or loon\'s flush rule. */\n\tchrome?: "float" | "loon";\n}';
const SHELL_PROMPT_4_ANCHOR = '\tconst clipped = truncateToWidth(line, layout.nativeWidth, "");\n\tconst content = borderColor("▎") + " " + clipped + " ".repeat(Math.max(0, layout.nativeWidth - visibleWidth(clipped))) + " ";\n\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m ";';
const SHELL_PROMPT_4_REPLACEMENT = '\tconst clipped = truncateToWidth(line, layout.nativeWidth, "");\n\tconst padding = " ".repeat(Math.max(0, layout.nativeWidth - visibleWidth(clipped)));\n\tif (layout.chrome === "loon") {\n\t\t// The rule lives INSIDE the surface: column 0 is a plain margin, and the glyph is the\n\t\t// first painted cell. The rule is a quarter block, so a cell carrying no background\n\t\t// leaves a dark hole around it - the rule floats, brighter than the band it guards.\n\t\t// The row still starts with a bare space, for the same reason the float row does: a\n\t\t// row whose first cell is an escape loses its ESC when the prompt editor trims that\n\t\t// cell. The glyph takes a theme role, never the terminal default colour, so it cannot\n\t\t// outshine the band. Text keeps column 2 and the surface closes on the last column,\n\t\t// where the bar closes its own.\n\t\tconst content = borderColor("▎") + clipped + padding + "  ";\n\t\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m";\n\t}\n\tconst content = borderColor("▎") + " " + clipped + padding + " ";\n\treturn " " + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m ";';
const SHELL_PROMPT_5_ANCHOR = '\tif (layout.background && lines.length >= 2) {\n\t\treturn [\n\t\t\tfloatPromptRow(floatPromptHint(lines[0], lines[lines.length - 1], options, layout.nativeWidth).slice(2), layout, options.borderColor),\n\t\t\t...lines.slice(1, -1).map((line) => floatPromptRow(line, layout, options.borderColor)),\n\t\t\tfloatPromptRow("", layout, options.borderColor),\n\t\t];\n\t}\n';
const SHELL_PROMPT_5_REPLACEMENT = '\tif (layout.background && lines.length >= 2) {\n\t\t// The band opens and closes with an empty surface row. Without the one above, the\n\t\t// surface started on the hint itself, which reads as text pressed against the top\n\t\t// edge; both rows are painted at the same width, so nothing else moves.\n\t\treturn [\n\t\t\tfloatPromptRow("", layout, options.borderColor),\n\t\t\tfloatPromptRow(floatPromptHint(lines[0], lines[lines.length - 1], options, layout.nativeWidth).slice(2), layout, options.borderColor),\n\t\t\t...lines.slice(1, -1).map((line) => floatPromptRow(line, layout, options.borderColor)),\n\t\t\tfloatPromptRow("", layout, options.borderColor),\n\t\t];\n\t}\n';
// LOON glyphs: the rose becomes the Agent marks, but only under a theme LOON generated.
// The mark and the spinner are the owner's, verbatim: «cuando trabaje el agente no salga ✿
// este glifo, cambialo por ✻ · ✢ ✳ ✶ ✻ ✽ ⏺ … eso cambiara solo si tengo el theme de
// LOON puesto en el gentle:customize». PROMPT_PETAL keeps its exact bytes, because every
// other theme renders through it; petalGlyph decides per call.
const SHELL_PROMPT_GLYPHS_ANCHOR = 'export const PROMPT_PETAL = "✿";\nconst PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;';
const SHELL_PROMPT_GLYPHS_REPLACEMENT = [
	'// LOON banner patch: the Agent marks - ✻ at rest, and seven marks spinning while the',
	'// agent works - shown instead of the rose, only under a theme LOON generated.',
	'export const PROMPT_PETAL = "✿";',
	'const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;',
	'export const AGENT_MARK_GLYPH = "✻";',
	'const AGENT_MARK_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "⏺"] as const;',
].join('\n');

const SHELL_PROMPT_PETAL_ANCHOR = [
	'export function petalGlyph(state: PromptState, tick: number): string {',
	'\tif (state === PROMPT_STATE.IDLE) return PROMPT_PETAL;',
	'\treturn PETAL_FRAMES[tick % PETAL_FRAMES.length];',
	'}',
].join('\n');
const SHELL_PROMPT_PETAL_REPLACEMENT = [
	'export function petalGlyph(state: PromptState, tick: number, agentMarks = false): string {',
	'\t// LOON banner patch: one decision, taken by the caller from the active theme\'s name.',
	'\t// At rest the mark stands still; while working it spins through the Agent marks.',
	'\tif (agentMarks) {',
	'\t\tif (state === PROMPT_STATE.IDLE) return AGENT_MARK_GLYPH;',
	'\t\treturn AGENT_MARK_FRAMES[tick % AGENT_MARK_FRAMES.length];',
	'\t}',
	'\tif (state === PROMPT_STATE.IDLE) return PROMPT_PETAL;',
	'\treturn PETAL_FRAMES[tick % PETAL_FRAMES.length];',
	'}',
].join('\n');

// The flag the prompt frame needs. It is a decision taken from the theme's name and handed
// down as a boolean, because this options object deliberately has no theme in it.
const SHELL_PROMPT_FLAG_ANCHOR = '\tpanelButton?: boolean;';
const SHELL_PROMPT_FLAG_REPLACEMENT = [
	'\tpanelButton?: boolean;',
	'\t/**',
	'\t * LOON banner patch: true when the active theme is one LOON generated. The rose',
	'\t * becomes the Agent mark, and while WORKING the activity leaves this frame for the',
	'\t * row above the prompt, so the frame paints neither the mark nor the label.',
	'\t */',
	'\tagentMarks?: boolean;',
].join('\n');

const SHELL_PROMPT_TOPRULE_ANCHOR = [
	'function topRule(width: number, options: PromptFrameOptions, indicator: string | undefined): string {',
	'\tconst label = indicator ?? stateLabel(options);',
	'\tconst scanning = options.state === PROMPT_STATE.WORKING;',
	'\tconst glyph = petalGlyph(options.state, options.tick);',
	'\tconst petal = options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph);',
	'\tconst paintedLabel = label && scanning && !indicator ? scanWorkingText(label, options.tick, options.fg) : label ? options.fg(LABEL_ROLE, label) : "";',
	'\tconst title = [petal, paintedLabel].filter(Boolean).join(" ");',
	'\tconst titleWidth = visibleWidth(glyph) + (label ? visibleWidth(label) + (glyph ? 1 : 0) : 0);',
	'\tconst fill = width - titleWidth - 5;',
	'\tif (fill < 0) return options.borderColor(`╭${rule(width - 2)}╮`);',
	'\treturn options.borderColor("╭─ ") + title + options.borderColor(` ${rule(fill)}╮`);',
	'}',
].join('\n');
const SHELL_PROMPT_TOPRULE_REPLACEMENT = [
	'function topRule(width: number, options: PromptFrameOptions, indicator: string | undefined): string {',
	'\t// LOON banner patch: while a theme LOON generated is working, the activity row above',
	'\t// the prompt carries both the mark and the label, so this rule carries neither. A',
	'\t// scroll indicator is not that activity, so it stays.',
	'\tconst moved = options.agentMarks === true && options.state === PROMPT_STATE.WORKING && indicator === undefined;',
	'\tconst label = moved ? undefined : indicator ?? stateLabel(options);',
	'\tconst scanning = options.state === PROMPT_STATE.WORKING;',
	'\tconst glyph = moved ? "" : petalGlyph(options.state, options.tick, options.agentMarks);',
	'\tconst petal = glyph ? options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph) : "";',
	'\tconst paintedLabel = label && scanning && !indicator ? scanWorkingText(label, options.tick, options.fg) : label ? options.fg(LABEL_ROLE, label) : "";',
	'\tconst title = [petal, paintedLabel].filter(Boolean).join(" ");',
	'\tconst titleWidth = visibleWidth(glyph) + (label ? visibleWidth(label) + (glyph ? 1 : 0) : 0);',
	'\tconst fill = width - titleWidth - 5;',
	'\tif (fill < 0) return options.borderColor(`╭${rule(width - 2)}╮`);',
	'\treturn options.borderColor("╭─ ") + title + options.borderColor(` ${rule(fill)}╮`);',
	'}',
].join('\n');

// The rounded frame, the painted band and the IDE panel all drew the activity in the prompt.
// Under a LOON theme none of them does: the row above the prompt owns it.
const SHELL_PROMPT_HINT_ANCHOR = [
	'function floatPromptHint(top: string, bottom: string, options: PromptFrameOptions, width: number): string {',
	'\tconst glyph = petalGlyph(options.state, options.tick);',
	'\tconst petal = options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph);',
	'\tconst label = stateLabel(options) ?? "waiting for input";',
	'\tlet paintedLabel = "";',
	'\tif (label) {',
	'\t\tpaintedLabel = options.state === PROMPT_STATE.WORKING',
	'\t\t\t? scanWorkingText(label, options.tick, options.fg)',
	'\t\t\t: options.fg(LABEL_ROLE, label);',
	'\t}',
	'\tconst info = [scrollIndicator(top), options.escHint ?? scrollIndicator(bottom)]',
	'\t\t.filter((text): text is string => Boolean(text))',
	'\t\t.map((text) => options.fg(LABEL_ROLE, text));',
	'\tconst hint = truncateToWidth("  " + petal + (paintedLabel ? " " + paintedLabel : "") + (info.length ? " · " + info.join(" · ") : ""), width, "");',
	'\treturn hint + " ".repeat(Math.max(0, width - visibleWidth(hint)));',
	'}',
].join('\n');
const SHELL_PROMPT_HINT_REPLACEMENT = [
	'function floatPromptHint(top: string, bottom: string, options: PromptFrameOptions, width: number): string {',
	'\t// LOON banner patch: while working under a theme LOON generated, the mark and the',
	'\t// label live on the activity row above the prompt, so this row keeps only what the',
	'\t// editor itself has to say. At rest it still carries the mark.',
	'\tconst moved = options.agentMarks === true && options.state === PROMPT_STATE.WORKING;',
	'\tconst glyph = petalGlyph(options.state, options.tick, options.agentMarks);',
	'\tconst petal = moved ? "" : options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph);',
	'\tconst label = moved ? "" : stateLabel(options) ?? "waiting for input";',
	'\tlet paintedLabel = "";',
	'\tif (label) {',
	'\t\tpaintedLabel = options.state === PROMPT_STATE.WORKING',
	'\t\t\t? scanWorkingText(label, options.tick, options.fg)',
	'\t\t\t: options.fg(LABEL_ROLE, label);',
	'\t}',
	'\tconst info = [scrollIndicator(top), options.escHint ?? scrollIndicator(bottom)]',
	'\t\t.filter((text): text is string => Boolean(text))',
	'\t\t.map((text) => options.fg(LABEL_ROLE, text));',
	'\t// One join, so a row with no mark does not open with two blank cells of padding.',
	'\tconst head = [petal, paintedLabel].filter(Boolean).join(" ");',
	'\tconst hint = truncateToWidth("  " + head + (info.length > 0 ? (head ? " · " : "") + info.join(" · ") : ""), width, "");',
	'\treturn hint + " ".repeat(Math.max(0, width - visibleWidth(hint)));',
	'}',
].join('\n');

const SHELL_PROMPT_PANEL_ANCHOR = [
	'function panelPromptRule(width: number, options: PromptFrameOptions, top: string | undefined, right: string | undefined): string {',
	'\tconst glyph = petalGlyph(options.state, options.tick);',
	'\tconst petal = options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph);',
	'\tconst label = top ?? stateLabel(options) ?? "waiting for input";',
].join('\n');
const SHELL_PROMPT_PANEL_REPLACEMENT = [
	'function panelPromptRule(width: number, options: PromptFrameOptions, top: string | undefined, right: string | undefined): string {',
	'\t// LOON banner patch: the same move as the rounded rule and the band. A scroll',
	'\t// indicator (`top`) is not the activity, so it stays where it is.',
	'\tconst moved = options.agentMarks === true && options.state === PROMPT_STATE.WORKING && top === undefined;',
	'\tconst glyph = moved ? "" : petalGlyph(options.state, options.tick, options.agentMarks);',
	'\tconst petal = glyph ? options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph) : "";',
	'\tconst label = moved ? "" : top ?? stateLabel(options) ?? "waiting for input";',
].join('\n');

// The row the activity moves to. It is prompt chrome, so it lives here, next to the frames
// it used to be painted into, and the editor above the prompt is the one that places it.
const SHELL_PROMPT_ACTIVITY_ANCHOR =
	'export function framePromptLines(lines: string[], width: number, options: PromptFrameOptions, layout = resolvePromptLayout(width, options.style, options.bg)): string[] {';
const SHELL_PROMPT_ACTIVITY_REPLACEMENT = [
	'/**',
	' * LOON banner patch: the activity row, above the prompt, for a theme LOON generated.',
	' * Pi\'s own loader row (`⠼ Working`) is hidden by this extension, and the prompt frame',
	' * used to carry the animation instead; this is where that animation goes. It shows the',
	' * same dynamic label - "exploring…", "implementing…", the worker\'s name - because it',
	' * reads the very label the frame stopped painting.',
	' */',
	'export function agentActivityRow(options: PromptFrameOptions, width: number): string {',
	'\tconst state = PROMPT_STATE.WORKING;',
	'\tconst glyph = petalGlyph(state, options.tick, true);',
	'\tconst mark = options.fg(petalTone(state, options.tick), options.bold ? options.bold(glyph) : glyph);',
	'\tconst label = stateLabel({ ...options, state }) ?? "working…";',
	'\tconst painted = scanWorkingText(label, options.tick, options.fg);',
	'\tconst target = Math.max(0, Math.floor(width));',
	'\tconst row = ` ${mark} ${painted}`;',
	'\tconst clipped = truncateToWidth(row, target, "");',
	'\treturn clipped + " ".repeat(Math.max(0, target - visibleWidth(clipped)));',
	'}',
	'',
	'export function framePromptLines(lines: string[], width: number, options: PromptFrameOptions, layout = resolvePromptLayout(width, options.style, options.bg)): string[] {',
].join('\n');

// The card heading's mark follows the same theme rule as the prompt's: a theme LOON
// generated says so in its name, and only then does the heading lead with the Agent mark.
const SHELL_CARD_GLYPH_ANCHOR = 'export const CARD_GLYPH = "✿";';
const SHELL_CARD_GLYPH_REPLACEMENT = [
	'export const CARD_GLYPH = "✿";',
	'// LOON banner patch: the mark a theme LOON generated shows in a card\'s heading. A theme',
	'// this plugin generates carries " (LOON)" at the end of its name - the same convention',
	'// lib/shell-bar.ts reads - and every other theme keeps CARD_GLYPH byte for byte.',
	'const AGENT_MARK_GLYPH = "✻";',
	'',
	'// headingFits() keeps CARD_GLYPH on purpose: both marks are one cell wide, so the',
	'// columns it compares are the same either way, and it has no theme in hand.',
	'function cardGlyph(theme: CardTheme | undefined): string {',
	'\tconst name = (theme as (CardTheme & { name?: unknown }) | undefined)?.name;',
	'\treturn typeof name === "string" && name.endsWith(" (LOON)") ? AGENT_MARK_GLYPH : CARD_GLYPH;',
	'}',
].join('\n');

const SHELL_CARD_HEAD_ANCHOR = '\tconst head = `${card.glyph ?? CARD_GLYPH} ${card.title}`;';
const SHELL_CARD_HEAD_REPLACEMENT = '\tconst head = `${card.glyph ?? cardGlyph(theme)} ${card.title}`;';

const SHELL_CARD_ROWS_ANCHOR =
	'\tconst available = target - 6 - visibleWidth(`${card.glyph ?? CARD_GLYPH} `) - (card.subtitle ? visibleWidth(card.subtitle) + 3 : 0);';
const SHELL_CARD_ROWS_REPLACEMENT =
	'\tconst available = target - 6 - visibleWidth(`${card.glyph ?? cardGlyph(theme)} `) - (card.subtitle ? visibleWidth(card.subtitle) + 3 : 0);';

const SHELL_CARD_PANEL_ANCHOR =
	'\tconst left = `${lead}${theme.fg(TITLE_ROLE[card.tone], `${card.glyph ?? CARD_GLYPH} ${card.title}`)}${subtitle}`;';
const SHELL_CARD_PANEL_REPLACEMENT =
	'\tconst left = `${lead}${theme.fg(TITLE_ROLE[card.tone], `${card.glyph ?? cardGlyph(theme)} ${card.title}`)}${subtitle}`;';

// LOON agent marks: extensions/gentle-shell.ts. The theme only reaches the prompt editor
// through the factory, so the decision is taken there and read per render.
const SHELL_MARKS_IMPORT_ANCHOR =
	'import { DOUBLE_ESC_CANCEL_HINT, floatPromptRow, framePromptLines, panelPromptRow, resolvePromptLayout, IDLE_ESC_CLEAR_HINT, PANEL_BUTTON, PROMPT_HINT, PROMPT_STATE, SHELL_PULSE_WATCHDOG_MS, withPromptHint, type PromptState } from "../lib/shell-prompt.ts";';
const SHELL_MARKS_IMPORT_REPLACEMENT =
	'import { agentActivityRow, DOUBLE_ESC_CANCEL_HINT, floatPromptRow, framePromptLines, panelPromptRow, resolvePromptLayout, IDLE_ESC_CLEAR_HINT, PANEL_BUTTON, PROMPT_HINT, PROMPT_STATE, SHELL_PULSE_WATCHDOG_MS, withPromptHint, type PromptState } from "../lib/shell-prompt.ts";';

const SHELL_MARKS_DEPS_ANCHOR = [
	'\t/**',
	'\t * Read fresh on every render while WORKING: the explicit, orchestrator-reported',
	'\t * ODD phase label for the current session, or undefined to fall back to the',
	'\t * generic "working…" label. Never applied to IDLE or QUEUED.',
	'\t */',
	'\tworkingLabel?: () => string | undefined;',
].join('\n');
const SHELL_MARKS_DEPS_REPLACEMENT = [
	'\t/**',
	'\t * Read fresh on every render while WORKING: the explicit, orchestrator-reported',
	'\t * ODD phase label for the current session, or undefined to fall back to the',
	'\t * generic "working…" label. Never applied to IDLE or QUEUED.',
	'\t */',
	'\tworkingLabel?: () => string | undefined;',
	'\t/**',
	'\t * LOON banner patch: true while the active theme is one LOON generated. The rose',
	'\t * becomes the Agent mark, and while WORKING the frame stops painting the activity.',
	'\t * Read on every render, so a theme switch needs no new editor.',
	'\t */',
	'\tagentMarks?: () => boolean;',
	'\t/**',
	'\t * LOON banner patch: true when this editor paints the working activity on its own row',
	'\t * above the prompt. False while Pi draws its own loader row (Herdr), because then a',
	'\t * second row would say the same thing twice.',
	'\t */',
	'\tactivityRow?: () => boolean;',
].join('\n');

// The option travels to the frame without a local: the anchor is one complete property, so
// the same edit applies to a real file and to a stand-in.
const SHELL_MARKS_FRAME_ANCHOR = '\t\t\ttick: this.tick,';
const SHELL_MARKS_FRAME_REPLACEMENT = [
	'\t\t\ttick: this.tick,',
	'\t\t\t// LOON banner patch: read per render, so a theme change needs no new editor.',
	'\t\t\tagentMarks: this.deps.agentMarks?.() ?? false,',
].join('\n');

const SHELL_MARKS_TOPROWS_ANCHOR = [
	'\t\t// The shell decides what goes above the editor (work row, agent questions) for every frame style.',
	'\t\tconst topRows = this.deps.topRows?.(width, this.hoveredTopRow) ?? [];',
].join('\n');
const SHELL_MARKS_TOPROWS_REPLACEMENT = [
	'\t\t// The shell decides what goes above the editor (work row, agent questions) for every frame style.',
	'\t\tconst topRows = this.deps.topRows?.(width, this.hoveredTopRow) ?? [];',
	'\t\t// LOON banner patch: the working activity moves here, one row above the prompt, and',
	'\t\t// out of the frame - the same dynamic label, under the Agent marks. It goes last, so',
	'\t\t// the rows the shell already owns keep their indices and their clicks.',
	'\t\tif ((this.deps.agentMarks?.() ?? false) && this.deps.activityRow?.() === true && state === PROMPT_STATE.WORKING) {',
	'\t\t\ttopRows.push(agentActivityRow({ state, tick: this.tick, fg: this.deps.fg, bold: this.deps.bold, workingLabel: this.deps.workingLabel?.() }, width));',
	'\t\t}',
].join('\n');

// The decision lives inside installPrompt, because installPrompt is a module-level function:
// a delegate that closes over the session_start handler's locals is a free identifier there,
// the factory runs when pi builds the editor at startup, and the ReferenceError takes the
// whole extension down with it. This is the anchor that keeps the two in the same scope.
const SHELL_MARKS_SCOPE_ANCHOR = '\tconst previous = ctx.ui.getEditorComponent() as PromptFactory | undefined;';
const SHELL_MARKS_SCOPE_REPLACEMENT = [
	'\tconst previous = ctx.ui.getEditorComponent() as PromptFactory | undefined;',
	'\t// LOON banner patch: the theme is read HERE, inside installPrompt, and not in the',
	'\t// session_start handler that calls it - that handler declares its own bindings, and',
	'\t// this function is module-level, so closing over them would be a free identifier the',
	'\t// factory only trips over at startup. The theme name is the one convention',
	'\t// lib/shell-bar.ts already reads.',
	'\tconst loonMarks = () => {',
	'\t\tconst name = (ctx.ui.theme as { name?: unknown }).name;',
	'\t\treturn typeof name === "string" && name.endsWith(" (LOON)");',
	'\t};',
].join('\n');

const SHELL_MARKS_FACTORY_ANCHOR =
	'\t\t\tworkingLabel: () => oddPhaseRegistry.label(ctx.sessionManager.getSessionId()),';
const SHELL_MARKS_FACTORY_REPLACEMENT = [
	'\t\t\tworkingLabel: () => oddPhaseRegistry.label(ctx.sessionManager.getSessionId()),',
	'\t\t\tagentMarks: loonMarks,',
	'\t\t\t// keepNativeWorkingRow() reads process.env, which is the env this extension starts',
	'\t\t\t// with; the handler\'s own `env` is not in scope here for the same reason.',
	'\t\t\tactivityRow: () => loonMarks() && !keepNativeWorkingRow(),',
].join('\n');

// The native Banner loop is left exactly as gentle-pi writes it: the 4.6.0 loop already
// produces one row per setting with a radio per state. Replacing it was the regression.
const SHELL_SOURCE_ANCHOR = "\t\t\tfor (const [setting, key] of [[\"Banner rose\", \"showRose\"], [\"Banner text logo\", \"showTextLogo\"]] as const) {\n\t\t\t\tfor (const enabled of [true, false]) add(\n\t\t\t\t\t() => `${setting}: ${enabled ? \"on\" : \"off\"}${banner[key] === enabled ? \" (current)\" : \"\"}`,\n\t\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\t\tasync () => {\n\t\t\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome), [key]: enabled };\n\t\t\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\t\t\tbanner = next;\n\t\t\t\t\t},\n\t\t\t\t\t() => bannerPreview({ ...banner, [key]: enabled }),\n\t\t\t\t\texplicitChoice(setting, enabled ? \"on\" : \"off\", () => banner[key] === enabled),\n\t\t\t\t);\n\t\t\t}";
const SHELL_SOURCE_ROWS = "\t\t\t// LOON banner patch v4: the source decides which banner is painted, so this row is\n\t\t\t// always live: it is the only way back from off.\n\t\t\tfor (const source of [\"loon\", \"rose\", \"off\"] as const) add(\n\t\t\t\t() => `Banner source: ${source}${loonBannerSource === source ? \" (current)\" : \"\"}`,\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { await saveLoonBannerSource(source); },\n\t\t\t\t() => source === \"rose\" ? bannerPreview(banner)\n\t\t\t\t\t: source === \"off\" ? { title: \"Banner · off (static)\", sample: \"·  pi's own header at next startup\" }\n\t\t\t\t\t: { title: \"Banner · LOON (static)\", sample: \"█  LOON header at next startup\" },\n\t\t\t\texplicitChoice(\"Banner source\", source, () => loonBannerSource === source),\n\t\t\t);\n\n\t\t\t// gentle-pi's own rose and text logo only exist while it paints: in loon mode LOON\n\t\t\t// draws and both rows govern nothing, which is what the owner called \"por las puras\".\n\t\t\tif (loonBannerSource === \"rose\") {\n\t\t\t\t\tfor (const [setting, key] of [[\"Banner rose\", \"showRose\"], [\"Banner text logo\", \"showTextLogo\"]] as const) {\n\t\t\t\t\t\tfor (const enabled of [true, false]) add(\n\t\t\t\t\t\t\t() => `${setting}: ${enabled ? \"on\" : \"off\"}${banner[key] === enabled ? \" (current)\" : \"\"}`,\n\t\t\t\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\t\t\t\tasync () => {\n\t\t\t\t\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome), [key]: enabled };\n\t\t\t\t\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\t\t\t\t\tbanner = next;\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t() => bannerPreview({ ...banner, [key]: enabled }),\n\t\t\t\t\t\t\texplicitChoice(setting, enabled ? \"on\" : \"off\", () => banner[key] === enabled),\n\t\t\t\t\t\t);\n\t\t\t\t\t}\n\t\t\t}";
// Appended after the native colours, so the Banner color row carries all six values.
// Picking a named colour returns the accent to gentle-pi's palette. The alternative was
// duplicating the row, which is how one setting ended up as two rows in the menu.
const SHELL_COLOR_ANCHOR = "\t\t\tfor (const color of BANNER_COLORS) add(\n\t\t\t\t() => `Banner color: ${color}${banner.color === color ? \" (current)\" : \"\"}`,\n\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\tasync () => { const next = { ...await readBannerConfigForEdit(bannerHome), color }; await writeBannerConfig(next, bannerHome); banner = next; },\n\t\t\t\t() => bannerPreview({ ...banner, color }),\n\t\t\t\t{ setting: \"Banner color\", value: color, current: () => banner.color === color, hint: \"Startup banner color; applies at next startup\" },\n\t\t\t);";
const SHELL_COLOR_REPLACEMENT = "\t\t\t// Nothing is drawn when the source is off, so no colour can govern anything.\n\t\t\tif (loonBannerSource !== \"off\") {\n\t\t\t\tfor (const color of BANNER_COLORS) add(\n\t\t\t\t\t() => `Banner color: ${color}${loonBannerColorCurrent(color) ? \" (current)\" : \"\"}`,\n\t\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\t\tasync () => { const next = { ...await readBannerConfigForEdit(bannerHome), color }; await writeBannerConfig(next, bannerHome); banner = next; await saveLoonAccent(\"banner\"); },\n\t\t\t\t\t() => bannerPreview({ ...banner, color }),\n\t\t\t\t\t{ setting: \"Banner color\", value: color, current: () => loonBannerColorCurrent(color), hint: \"Startup banner color; applies at next startup\" },\n\t\t\t\t);\n\t\t\t}";
const SHELL_ACCENT_ANCHOR = "\t\t\tcategory = \"Themes\";"
const SHELL_ACCENT_ROWS = "\t\t\t// The theme and wallpaper accents, and the mark, are settings LOON applies. While\n\t\t\t// gentle-pi paints it owns the banner colour and these govern nothing.\n\t\t\tif (loonBannerSource === \"loon\") {\n\t\t\t\t// LOON banner patch v3: the theme and wallpaper accents are two more values of\n\t\t\t\t// gentle-pi's own Banner color setting, so one row carries all six.\n\t\t\t\tadd(\n\t\t\t\t\t() => \"Banner color: theme (LOON)\",\n\t\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\t\tasync () => { await saveLoonAccent(\"theme\"); },\n\t\t\t\t\t() => ({ title: \"Theme accent (static)\", sample: \"·  the active theme's accent role\" }),\n\t\t\t\t\texplicitChoice(\"Banner color\", \"theme\", () => loonSettings.accent === \"theme\"),\n\t\t\t\t);\n\t\t\t\tadd(\n\t\t\t\t\t() => \"Banner color: wallpaper (LOON)\",\n\t\t\t\t\t\"Banner saved; applies at next startup.\",\n\t\t\t\t\tasync () => { await saveLoonAccent(\"wallpaper\"); loonWallpaperAccent = await readWallpaperAccent(); },\n\t\t\t\t\t() => loonWallpaperAccent === undefined\n\t\t\t\t\t\t? { title: \"Wallpaper accent · unavailable (static)\", sample: \"·  falls back to the theme accent\" }\n\t\t\t\t\t\t: { title: `Wallpaper accent · ${loonWallpaperAccent.hex} (static)`, sample: `\\x1b[38;2;${loonWallpaperAccent.rgb[0]};${loonWallpaperAccent.rgb[1]};${loonWallpaperAccent.rgb[2]}m█\\x1b[0m  wallpaper accent` },\n\t\t\t\t\texplicitChoice(\"Banner color\", \"wallpaper\", () => loonSettings.accent === \"wallpaper\"),\n\t\t\t\t);\n\t\t\t\t// LOON banner patch v3: the mark is LOON's own switch, grouped as one setting.\n\t\t\t\tfor (const mark of [\"on\", \"off\"] as const) add(\n\t\t\t\t\t() => `Mark: ${mark}${(loonSettings.mark === false ? \"off\" : \"on\") === mark ? \" (current)\" : \"\"}`,\n\t\t\t\t\t\"Mark saved.\",\n\t\t\t\t\tasync () => { await writeLoonSettings({ ...loonSettings, mark: mark === \"on\" }); },\n\t\t\t\t\tundefined,\n\t\t\t\t\texplicitChoice(\"Mark\", mark, () => (loonSettings.mark === false ? \"off\" : \"on\") === mark),\n\t\t\t\t);\n\t\t\t}" + "\n" + SHELL_ACCENT_ANCHOR;
// Picking a named colour returns the accent to gentle-pi's palette; the alternative was
// duplicating the row, which is how the menu ended up with two rows for one setting.


const SHELL_MOUSE_ANCHOR = "\thandleMouse(event: Parameters<CustomEditor[\"handleMouse\"]>[0]): ReturnType<CustomEditor[\"handleMouse\"]> {\n\t\tconst onPanel = (this.deps.panelButton?.() ?? true) && this.panelStart !== undefined && this.floatMouseLayout?.panel && event.width === this.floatMouseLayout.width && event.y === this.topRowCount &&\n\t\t\tevent.x >= this.panelStart && event.x < this.panelStart + visibleWidth(PANEL_BUTTON);\n\t\tif (event.type === \"move\" && event.button === \"none\") {\n\t\t\tif (onPanel || (event.y >= 0 && event.y < this.topRowCount)) setSidebarHover(this.pointerTui, this, () => this.clearEditorHover());\n\t\t\telse setSidebarHover(this.pointerTui);\n\t\t\tif (onPanel) {\n\t\t\t\tconst changed = this.hoveredTopRow !== undefined || !this.hoveredPanel;\n\t\t\t\tif (this.hoveredTopRow !== undefined) { this.hoveredTopRow = undefined; this.deps.requestRender(); }\n\t\t\t\tif (!this.hoveredPanel) { this.hoveredPanel = true; this.deps.requestRender(); }\n\t\t\t\treturn changed ? { handled: true, render: true } : { handled: true };\n\t\t\t}\n\t\t\tthis.clearPanelHover();\n\t\t}\n\t\tif (onPanel && (event.type === \"press\" || event.type === \"click\")) {\n\t\t\tif (event.type === \"click\" && event.button === \"left\") {\n\t\t\t\tthis.clearEditorHover();\n\t\t\t\tthis.deps.onPanelClick?.();\n\t\t\t}\n\t\t\treturn { handled: true, render: event.type === \"click\" };\n\t\t}\n\t\t// Rows drawn above the panel rule belong to the shell, not to Pi's editor.\n\t\tif (this.topRowCount > 0) {\n\t\t\tif (event.y < this.topRowCount) {\n\t\t\t\t// Hovering a top row paints it as clickable, like every other control.\n\t\t\t\tif (event.type === \"move\" && event.button === \"none\") {\n\t\t\t\t\tif (this.hoveredTopRow !== event.y) {\n\t\t\t\t\t\tthis.hoveredTopRow = event.y;\n\t\t\t\t\t\tthis.deps.requestRender();\n\t\t\t\t\t\treturn { handled: true, render: true };\n\t\t\t\t\t}\n\t\t\t\t\treturn { handled: true };\n\t\t\t\t}\n\t\t\t\tif (event.type !== \"click\" || event.button !== \"left\") return undefined;\n\t\t\t\tthis.deps.onTopRowClick?.(event.y);\n\t\t\t\treturn { handled: true, render: true };\n\t\t\t}\n\t\t\tif (this.hoveredTopRow !== undefined) {\n\t\t\t\tthis.hoveredTopRow = undefined;\n\t\t\t\tthis.deps.requestRender();\n\t\t\t}\n\t\t\tevent = { ...event, y: event.y - this.topRowCount, height: event.height - this.topRowCount };\n\t\t}\n\t\tconst layout = this.floatMouseLayout;\n\t\tif (!layout) return super.handleMouse(event);\n\t\t// Row coordinates stay native: padding=0, content=1…N, hint=N+1.\n\t\t// Float and panel translate x; the existing neon/fallback path is unchanged.\n\t\tif (event.x < layout.prefixWidth || event.x >= (layout.panel ? layout.prefixWidth + layout.nativeWidth : layout.width - 1)) return undefined;\n\t\treturn super.handleMouse({ ...event, x: event.x - layout.prefixWidth, width: layout.nativeWidth });\n\t}";
const SHELL_MOUSE_REPLACEMENT = "\thandleMouse(event: Parameters<CustomEditor[\"handleMouse\"]>[0]): ReturnType<CustomEditor[\"handleMouse\"]> {\n\t\tconst onPanel = (this.deps.panelButton?.() ?? true) && this.panelStart !== undefined && this.floatMouseLayout?.panel && event.width === this.floatMouseLayout.width && event.y === this.topRowCount &&\n\t\t\tevent.x >= this.panelStart && event.x < this.panelStart + visibleWidth(PANEL_BUTTON);\n\t\tif (event.type === \"move\" && event.button === \"none\") {\n\t\t\tif (onPanel || (event.y >= 0 && event.y < this.topRowCount)) setSidebarHover(this.pointerTui, this, () => this.clearEditorHover());\n\t\t\telse setSidebarHover(this.pointerTui);\n\t\t\tif (onPanel) {\n\t\t\t\tconst changed = this.hoveredTopRow !== undefined || !this.hoveredPanel;\n\t\t\t\tif (this.hoveredTopRow !== undefined) { this.hoveredTopRow = undefined; this.deps.requestRender(); }\n\t\t\t\tif (!this.hoveredPanel) { this.hoveredPanel = true; this.deps.requestRender(); }\n\t\t\t\treturn changed ? { handled: true, render: true } : { handled: true };\n\t\t\t}\n\t\t\tthis.clearPanelHover();\n\t\t}\n\t\tif (onPanel && (event.type === \"press\" || event.type === \"click\")) {\n\t\t\tif (event.type === \"click\" && event.button === \"left\") {\n\t\t\t\tthis.clearEditorHover();\n\t\t\t\tthis.deps.onPanelClick?.();\n\t\t\t}\n\t\t\treturn { handled: true, render: event.type === \"click\" };\n\t\t}\n\t\t// Rows drawn above the panel rule belong to the shell, not to Pi's editor.\n\t\tif (this.topRowCount > 0) {\n\t\t\tif (event.y < this.topRowCount) {\n\t\t\t\t// Hovering a top row paints it as clickable, like every other control.\n\t\t\t\tif (event.type === \"move\" && event.button === \"none\") {\n\t\t\t\t\tif (this.hoveredTopRow !== event.y) {\n\t\t\t\t\t\tthis.hoveredTopRow = event.y;\n\t\t\t\t\t\tthis.deps.requestRender();\n\t\t\t\t\t\treturn { handled: true, render: true };\n\t\t\t\t\t}\n\t\t\t\t\treturn { handled: true };\n\t\t\t\t}\n\t\t\t\tif (event.type !== \"click\" || event.button !== \"left\") return undefined;\n\t\t\t\tthis.deps.onTopRowClick?.(event.y);\n\t\t\t\treturn { handled: true, render: true };\n\t\t\t}\n\t\t\tif (this.hoveredTopRow !== undefined) {\n\t\t\t\tthis.hoveredTopRow = undefined;\n\t\t\t\tthis.deps.requestRender();\n\t\t\t}\n\t\t\tevent = { ...event, y: event.y - this.topRowCount, height: event.height - this.topRowCount };\n\t\t}\n\t\tconst layout = this.floatMouseLayout;\n\t\tif (!layout) return super.handleMouse(event);\n\t\t// Pi row model: padding=0, content=1…N, hint=N+1. The band now opens with an empty\n\t\t// surface row of its own, so native content starts one row lower than that model:\n\t\t// y loses exactly that row here. Float and the IDE panel translate x; the\n\t\t// existing neon/fallback path is untouched.\n\t\tconst edge = layout.panel ? layout.prefixWidth + layout.nativeWidth : layout.width - 1;\n\t\tif (event.x < layout.prefixWidth || event.x >= edge) return undefined;\n\t\treturn super.handleMouse({ ...event, x: event.x - layout.prefixWidth, y: event.y - 1, width: layout.nativeWidth });\n\t}";

// The third Card style row needs its own preview line, or the menu prints an
// undefined sample for it.
const SHELL_CARD_PREVIEW_ANCHOR = '\t\t\tconst cardStylePreview = { [CARD_STYLE.NEON]: "╭─ ✿ read ─╮  outlined chrome + prompt", [CARD_STYLE.FLOAT]: "▎ ✿ read  painted chrome + prompt" };';
const SHELL_CARD_PREVIEW_REPLACEMENT = '\t\t\tconst cardStylePreview = { [CARD_STYLE.NEON]: "╭─ ✿ read ─╮  outlined chrome + prompt", [CARD_STYLE.FLOAT]: "▎ ✿ read  painted chrome + prompt", [CARD_STYLE.LOON]: "▎ ✿ read  flush rule, text at column 2, two columns of air" };';

export const ANCHORS = {
	shellInit: SHELL_INIT_ANCHOR,
	shellSource: SHELL_SOURCE_ANCHOR,
	shellAccent: SHELL_ACCENT_ANCHOR,
	shellColor: SHELL_COLOR_ANCHOR,
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
	shellPromptGlyphs: SHELL_PROMPT_GLYPHS_ANCHOR,
	shellPromptPetal: SHELL_PROMPT_PETAL_ANCHOR,
	shellPromptFlag: SHELL_PROMPT_FLAG_ANCHOR,
	shellPromptTopRule: SHELL_PROMPT_TOPRULE_ANCHOR,
	shellPromptHint: SHELL_PROMPT_HINT_ANCHOR,
	shellPromptPanel: SHELL_PROMPT_PANEL_ANCHOR,
	shellPromptActivity: SHELL_PROMPT_ACTIVITY_ANCHOR,
	shellcardGlyph: SHELL_CARD_GLYPH_ANCHOR,
	shellcardHead: SHELL_CARD_HEAD_ANCHOR,
	shellcardRows: SHELL_CARD_ROWS_ANCHOR,
	shellcardPanel: SHELL_CARD_PANEL_ANCHOR,
	shellMarksImport: SHELL_MARKS_IMPORT_ANCHOR,
	shellMarksDeps: SHELL_MARKS_DEPS_ANCHOR,
	shellMarksFrame: SHELL_MARKS_FRAME_ANCHOR,
	shellMarksTopRows: SHELL_MARKS_TOPROWS_ANCHOR,
	shellMarksScope: SHELL_MARKS_SCOPE_ANCHOR,
	shellMarksFactory: SHELL_MARKS_FACTORY_ANCHOR,
	shellMouse: SHELL_MOUSE_ANCHOR,

};

export const TARGETS: TargetSpec[] = [
	{
		file: 'extensions/gentle-shell.ts',
		md5: '870867458af13b1a6a411b4a4e3cd5b2',
		// Newest first: the patch before the Agent marks, the patch before the mark row, the patch
		// before the theme accent, then the older patched states from before the v2 rows.
		md5PatchedV1: ['9c77666b43b7aa6fbe3f761dee03d624', 'bc7197600a9f1482ed4e86bd1119b4d8', '7da141c898257cf56230f735fe4c553e', 'ec03598026098aefe27e1cd4dcfe7393', 'b12919486a662d03f1587ee719d0bd73', 'f389ce976bc0a92e65b5d2f9e9b5dd3d', '24763fed19449f3a4e31a52bbe1be72e', '8ae96c97de14436e9755608a81579441', 'b808107af050aa1778410fefa67974df', '945363c38d21403cce653143e0305a6a', '3075925c2f5ac762bf8a545e1ee33915', 'cf86ef5ca39a5e1d4135e01b379b469c', 'd3c362b675260233fd87ac0850f608bd', '14bc306579491b3fcaa496c147724bb8', '2bc6883c2ad02abea7d7c8e4c6ca2c42'],
		md5Patched: '871cf1d257931ed743fd6067fd9819fa',
		v2Marker: 'Banner color: wallpaper',
		edits: [
			{ anchor: SHELL_INIT_ANCHOR, replacement: SHELL_INIT_ANCHOR + '\n' + SHELL_INIT_ADDITION },
			{ anchor: SHELL_SOURCE_ANCHOR, replacement: SHELL_SOURCE_ROWS },
			{ anchor: SHELL_ACCENT_ANCHOR, replacement: SHELL_ACCENT_ROWS },
			{ anchor: SHELL_COLOR_ANCHOR, replacement: SHELL_COLOR_REPLACEMENT },
			{ anchor: SHELL_CARD_PREVIEW_ANCHOR, replacement: SHELL_CARD_PREVIEW_REPLACEMENT },
			{ anchor: SHELL_MOUSE_ANCHOR, replacement: SHELL_MOUSE_REPLACEMENT },
			// The Agent marks: the flag travels from the theme at the factory to the frame, and
			// the working activity moves onto a row of its own above the prompt.
			{ anchor: SHELL_MARKS_IMPORT_ANCHOR, replacement: SHELL_MARKS_IMPORT_REPLACEMENT },
			{ anchor: SHELL_MARKS_DEPS_ANCHOR, replacement: SHELL_MARKS_DEPS_REPLACEMENT },
			{ anchor: SHELL_MARKS_FRAME_ANCHOR, replacement: SHELL_MARKS_FRAME_REPLACEMENT },
			{ anchor: SHELL_MARKS_TOPROWS_ANCHOR, replacement: SHELL_MARKS_TOPROWS_REPLACEMENT },
			{ anchor: SHELL_MARKS_SCOPE_ANCHOR, replacement: SHELL_MARKS_SCOPE_REPLACEMENT },
			{ anchor: SHELL_MARKS_FACTORY_ANCHOR, replacement: SHELL_MARKS_FACTORY_REPLACEMENT },
		],
	},
	{
		// The view calls a row's label with the width the row actually has, so a long
		// label can choose a shorter wording instead of being cut mid-word.
		file: 'lib/visual-customize-view.ts',
		md5: '5a052563d8d5dd86cb4781c0681c9a3c',
		md5Patched: '506ab79c84daadff5925d7ef28a87677',
		md5PatchedV1: ['23bb9997b474842fe5f2a4d652c4178b'],
		edits: [
			{ anchor: VIEW_LABEL_TYPE_ANCHOR, replacement: VIEW_LABEL_TYPE_REPLACEMENT },
			{ anchor: VIEW_LABEL_CALL_ANCHOR, replacement: VIEW_LABEL_CALL_REPLACEMENT },
		],
	},
	{
		file: 'extensions/startup-banner.ts',
		md5: 'c3fc54e35488c17c82a81ff2c4ed0271',
		// Its patched bytes are the same in both versions: the guard did not change.
		md5Patched: '5d10cdb23b6c660d96bfd0d45f8a74df',
		md5PatchedV1: ['79167d2ce9c12de796f7c751778d0b18'],
		edits: [
			{ anchor: BANNER_EVENT_ANCHOR, replacement: BANNER_EVENT_REPLACEMENT },
			{ anchor: BANNER_CONFIG_ANCHOR, replacement: BANNER_CONFIG_ANCHOR + '\n' + BANNER_CONFIG_ADDITION },
		],
	},
	{
		// The header bar's brand: a theme LOON generated says so in its name, and the
		// brand gives way to it. Stock themes keep the bar exactly as it was.
		file: 'lib/shell-bar.ts',
		md5: '19334914e8fc284b993fa2c148e3b697',
		md5Patched: '2ddbe9f15fe16552ff98d0dd9ac17ff6',
		md5PatchedV1: ['5b43e3127eae0024d45b21eec34b1a95', '36afe7b323c27f7c2753a22d08cb57fa', 'c4392741927c8da26d0b9d24142e3a41'],
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
		md5: '2faa9cdac2e2358e5950a82d068708b4',
		md5Patched: 'a3abcf04ed66f2dc092284cd2b3df2f6',
		md5PatchedV1: ['7645215425b4c59bd3bbdf90fde97dbc', '8f3460ef6d3a5222d7a26662bb46b642', '8dbecc2f2ac057b87ce5c344d7ba5241'],
		edits: [
			{ anchor: SHELL_CARD_1_ANCHOR, replacement: SHELL_CARD_1_REPLACEMENT },
			{ anchor: SHELL_CARD_2_ANCHOR, replacement: SHELL_CARD_2_REPLACEMENT },
			{ anchor: SHELL_CARD_3_ANCHOR, replacement: SHELL_CARD_3_REPLACEMENT },
			{ anchor: SHELL_CARD_4_ANCHOR, replacement: SHELL_CARD_4_REPLACEMENT },
			{ anchor: SHELL_CARD_5_ANCHOR, replacement: SHELL_CARD_5_REPLACEMENT },
			{ anchor: SHELL_CARD_6_ANCHOR, replacement: SHELL_CARD_6_REPLACEMENT },
			{ anchor: SHELL_CARD_7_ANCHOR, replacement: SHELL_CARD_7_REPLACEMENT },
			// The heading's mark follows the theme, in every path that paints one.
			{ anchor: SHELL_CARD_GLYPH_ANCHOR, replacement: SHELL_CARD_GLYPH_REPLACEMENT },
			{ anchor: SHELL_CARD_HEAD_ANCHOR, replacement: SHELL_CARD_HEAD_REPLACEMENT },
			{ anchor: SHELL_CARD_ROWS_ANCHOR, replacement: SHELL_CARD_ROWS_REPLACEMENT },
			{ anchor: SHELL_CARD_PANEL_ANCHOR, replacement: SHELL_CARD_PANEL_REPLACEMENT },
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
		md5: '70f028ae3d61ccd471f5e346b5111e9e',
		md5Patched: 'a86e804371554af8653442886919ed1c',
		md5PatchedV1: ['afcd1b6ec35d955b45a565c2a5eb433b', '993a7f2237db3eb718b9d6ab05591bf1', 'fa3cc52522ee55195f48ceeee9c47259', '040c2b8c8ca1f727aa937ca6e5204375', '0618298301450ad9811a4d7b287bc3cd', '2174a62f342df42f37d2a78b53b2a9e0', '6ed83675ab5a63201df8ea38867cee8d', '5bd10c1347200edb2f181e7631e67b52', '0d07a750ae6162d2c8bbfbda7760e55f', 'ddb8bd748ae664cb28f9f0307e0917e5'],
		edits: [
			{ anchor: SHELL_PROMPT_1_ANCHOR, replacement: SHELL_PROMPT_1_REPLACEMENT },
			{ anchor: SHELL_PROMPT_2_ANCHOR, replacement: SHELL_PROMPT_2_REPLACEMENT },
			{ anchor: SHELL_PROMPT_3_ANCHOR, replacement: SHELL_PROMPT_3_REPLACEMENT },
			{ anchor: SHELL_PROMPT_4_ANCHOR, replacement: SHELL_PROMPT_4_REPLACEMENT },
			{ anchor: SHELL_PROMPT_5_ANCHOR, replacement: SHELL_PROMPT_5_REPLACEMENT },
			// The Agent marks, and the activity row that replaces the one inside the frame.
			{ anchor: SHELL_PROMPT_GLYPHS_ANCHOR, replacement: SHELL_PROMPT_GLYPHS_REPLACEMENT },
			{ anchor: SHELL_PROMPT_PETAL_ANCHOR, replacement: SHELL_PROMPT_PETAL_REPLACEMENT },
			{ anchor: SHELL_PROMPT_FLAG_ANCHOR, replacement: SHELL_PROMPT_FLAG_REPLACEMENT },
			{ anchor: SHELL_PROMPT_TOPRULE_ANCHOR, replacement: SHELL_PROMPT_TOPRULE_REPLACEMENT },
			{ anchor: SHELL_PROMPT_HINT_ANCHOR, replacement: SHELL_PROMPT_HINT_REPLACEMENT },
			{ anchor: SHELL_PROMPT_PANEL_ANCHOR, replacement: SHELL_PROMPT_PANEL_REPLACEMENT },
			{ anchor: SHELL_PROMPT_ACTIVITY_ANCHOR, replacement: SHELL_PROMPT_ACTIVITY_REPLACEMENT },
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

	// Every backup holds the pristine 4.6.0 bytes, so `revert` always has something
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
 * which is the file to give back. The pinned digest of gentle-pi 4.6.0 is not the gate
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
