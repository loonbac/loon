/**
 * Which language a work unit is written in.
 *
 * The router keeps per-language evidence. Its exploration slot samples by
 * `(candidate, language)`, so a model can be established in one language and
 * still unproven in another, and `rowsForTaskClass` filters rows by language.
 * That needs the host to name the language: the router itself only sees a task
 * string and a cwd, and deliberately has no detector.
 *
 * Two sources, most specific first:
 *
 *   1. The task text, when it names a file with a known extension. A task about
 *      one shell script inside a Rust repository is a shell task, and reading the
 *      repository instead would file that evidence under Rust.
 *   2. The repository's dominant language, counted over the files Git tracks.
 *      Untracked build output and vendored trees are excluded by construction.
 *
 * Returns `undefined` when neither source is conclusive. That is a real answer:
 * the router treats an absent language as an absent axis, and the evidence lands
 * under the language-neutral key exactly as it did before this existed.
 */
import { spawnSync } from "node:child_process";

/** The languages the router has priors for. Anything else stays `undefined`. */
export const KNOWN_LANGUAGES = [
	"rust",
	"typescript",
	"javascript",
	"python",
	"go",
	"nix",
	"shell",
] as const;

export type KnownLanguage = (typeof KNOWN_LANGUAGES)[number];

const EXTENSION_LANGUAGES: Readonly<Record<string, KnownLanguage>> = {
	".rs": "rust",
	".ts": "typescript",
	".tsx": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".nix": "nix",
	".sh": "shell",
	".bash": "shell",
	".zsh": "shell",
};

type LanguageCounts = Map<KnownLanguage, number>;

function extensionOf(path: string): string | undefined {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return undefined;
	return name.slice(dot).toLowerCase();
}

function languageOfPath(path: string): KnownLanguage | undefined {
	const extension = extensionOf(path);
	return extension === undefined ? undefined : EXTENSION_LANGUAGES[extension];
}

/**
 * The language named by a file in the task text, when there is one.
 *
 * Matches text that looks like a path with a known extension (`.rs`, `src/main.go`)
 * rather than any dotted token, so a version number or a hostname cannot decide
 * the language. When several extensions appear, the most frequently named one
 * wins and ties break toward the first mention.
 */
export function languageFromTaskText(task: string): KnownLanguage | undefined {
	const counts: LanguageCounts = new Map();
	const order: KnownLanguage[] = [];
	for (const match of task.matchAll(/[\w./@~-]*\.[A-Za-z0-9]{1,6}(?![\w.])/gu)) {
		const language = languageOfPath(match[0]);
		if (language === undefined) continue;
		if (!counts.has(language)) order.push(language);
		counts.set(language, (counts.get(language) ?? 0) + 1);
	}
	if (counts.size === 0) return undefined;
	let best = order[0]!;
	for (const language of order) {
		if ((counts.get(language) ?? 0) > (counts.get(best) ?? 0)) best = language;
	}
	return best;
}

export interface RepositoryLanguageInput {
	/** Files to classify, one per entry, as Git would report them. */
	readonly files: readonly string[];
	/** Minimum share of classified files a language must hold to win. */
	readonly minimumShare?: number;
}

const DEFAULT_MINIMUM_SHARE = 0.4;

/**
 * The dominant language of an already-listed file set.
 *
 * A share threshold rather than a bare plurality: a repository with 30 Go files
 * and 25 YAML files should not resolve its language by a 5-file margin, and a
 * polyglot repository should be allowed to answer `undefined`. Only files with a
 * known extension count, so documentation and configuration never decide it.
 */
export function languageFromFiles(input: RepositoryLanguageInput): KnownLanguage | undefined {
	const counts: LanguageCounts = new Map();
	let classified = 0;
	for (const file of input.files) {
		const language = languageOfPath(file);
		if (language === undefined) continue;
		counts.set(language, (counts.get(language) ?? 0) + 1);
		classified += 1;
	}
	if (classified === 0) return undefined;
	const minimum = (input.minimumShare ?? DEFAULT_MINIMUM_SHARE) * classified;
	let best: KnownLanguage | undefined;
	let bestCount = 0;
	for (const language of KNOWN_LANGUAGES) {
		const count = counts.get(language) ?? 0;
		if (count > bestCount) {
			best = language;
			bestCount = count;
		}
	}
	return best !== undefined && bestCount >= minimum ? best : undefined;
}

function trackedFiles(cwd: string): string[] {
	// Git already excludes ignored output and vendored trees, which is exactly the
	// set that should not vote. A cap keeps a pathological repository bounded.
	const result = spawnSync("git", ["ls-files", "-z"], {
		cwd,
		encoding: "buffer",
		maxBuffer: 8 * 1024 * 1024,
		timeout: 5_000,
	});
	if (result.error || result.status !== 0 || result.stdout === null) return [];
	return String(result.stdout).split("\0").filter((entry) => entry.length > 0).slice(0, 20_000);
}

/**
 * The language a work unit runs in.
 *
 * `taskText` wins when it names a file, because the work is about that file even
 * when the repository around it is written in something else. The repository is
 * the fallback, and an inconclusive repository (polyglot, or not a Git checkout)
 * yields `undefined` rather than a guess.
 */
export function detectWorkUnitLanguage(taskText: string, cwd: string): KnownLanguage | undefined {
	return languageFromTaskText(taskText) ?? languageFromFiles({ files: trackedFiles(cwd) });
}
