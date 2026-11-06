/**
 * The repair's write side: backup first, then one atomic rename per file.
 *
 * The rule that matters is the one about failure. A backup is taken before anything is
 * written, but the new content is staged for every target and only then renamed into
 * place. If staging any file fails, no rename happens and gentle-pi is left exactly as it
 * was. That is the difference between "the patch did not apply" and "gentle-pi is now half
 * patched and nobody knows which half".
 *
 * Every operation is wrapped: this runs at session start, and a throw here would take the
 * whole extension — the banner, the accent, everything — down with it.
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repairSummary, repairVerdict, type RepairVerdict } from './patch-repair.ts';
import type { PatchableTarget } from './patch-target.ts';

export interface RepairPaths {
	/** The installed gentle-pi directory. */
	install: string;
	/** Where the timestamped backup of the originals goes. */
	backups: string;
	/** The stamp that makes a backup directory unique and orderable. */
	stamp: string;
}

export interface RepairReport {
	/** Files this run actually rewrote. */
	applied: string[];
	/** One line per file that could not be repaired, with the reason. */
	problems: string[];
	/** Where the originals were saved, when anything was written. */
	backup?: string;
}

/** Read a target, tolerating every way a read can fail. */
function readOrUndefined(path: string, read: (path: string) => string): string | undefined {
	try {
		return read(path);
	} catch {
		return undefined;
	}
}

/**
 * Repair every target that needs it, or none.
 *
 * `read` and `write` are injected so the whole decision, including its rollback path, is
 * testable without a gentle-pi install. The real callers pass node's own functions.
 */
export function repairPatch(
	targets: readonly PatchableTarget[],
	paths: RepairPaths,
	io: { read?: (path: string) => string; write?: (path: string, text: string) => void } = {},
): RepairReport {
	const read = io.read ?? ((path: string) => readFileSync(path, 'utf8'));
	const write = io.write ?? ((path: string, text: string) => writeFileSync(path, text, 'utf8'));

	const verdicts: RepairVerdict[] = [];
	for (const target of targets) {
		const path = join(paths.install, target.file);
		verdicts.push(repairVerdict(readOrUndefined(path, read), target));
	}

	const summary = repairSummary(verdicts);
	const problems = summary.problems.map((verdict) => verdict.reason ?? verdict.file + ': cannot repair');
	if (!summary.ready) return { applied: [], problems };

	const backup = join(paths.backups, 'gentle-pi-loon-repair-' + paths.stamp);
	// Staged content lives beside its target so the final step is a rename within one
	// filesystem, which is what makes it atomic.
	const staged: { path: string; temporary: string }[] = [];

	try {
		mkdirSync(backup, { recursive: true });
		for (const verdict of summary.writes) {
			const path = join(paths.install, verdict.file);
			const original = readOrUndefined(path, read);
			if (original === undefined) {
				return { applied: [], problems: [...problems, verdict.file + ': vanished before backup'] };
			}
			const savedTo = join(backup, verdict.file);
			mkdirSync(dirname(savedTo), { recursive: true });
			copyFileSync(path, savedTo);
		}
		for (const verdict of summary.writes) {
			const path = join(paths.install, verdict.file);
			const temporary = path + '.loon-' + paths.stamp + '.tmp';
			write(temporary, verdict.text ?? '');
			staged.push({ path, temporary });
		}
	} catch (error) {
		// Nothing was renamed yet: the install is untouched, and the staged files go away.
		for (const entry of staged) {
			try {
				rmSync(entry.temporary, { force: true });
			} catch {
				/* Already gone. */
			}
		}
		const reason = error instanceof Error ? error.message : String(error);
		return { applied: [], problems: [...problems, 'staging failed, nothing was written: ' + reason] };
	}

	const applied: string[] = [];
	for (const entry of staged) {
		try {
			renameSync(entry.temporary, entry.path);
			applied.push(entry.path);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			problems.push(entry.path + ': rename failed: ' + reason);
		}
	}

	return problems.length === 0 ? { applied, problems, backup } : { applied, problems, backup };
}

/**
 * Apply the patch by running the script that owns it, as its own process.
 *
 * Why a child process and not an import: the script is the tool a person runs by hand, and
 * it carries a `createRequire`, a jiti probe, a `process.exitCode` and the real anchors.
 * Importing it into pi's boot would make the startup path depend on all of that; running it
 * keeps one implementation of the patch and one place where the anchors live. Its exit code
 * is the verdict, and its own backup runs before its first write.
 *
 * Never throws: this is called at session start, and a failed repair is a message, not a
 * reason for the extension to disappear.
 */
export function repairPatchViaScript(
	options: { install: string; backups: string; script: string; node?: string; timeoutMs?: number },
	run: (
		command: string,
		args: string[],
		options: { encoding: 'utf8'; timeout: number },
	) => { status: number | null; stdout?: string; stderr?: string },
): RepairReport {
	try {
		const result = run(
			options.node ?? process.execPath,
			[
				'--experimental-strip-types',
				options.script,
				'apply',
				'--install',
				options.install,
				'--backups',
				options.backups,
			],
			{ encoding: 'utf8', timeout: options.timeoutMs ?? 60_000 },
		);
		if (result.status === 0) return { applied: [], problems: [] };
		const said = String(result.stderr ?? '')
			.trim()
			.split('\n')
			.filter(Boolean);
		return {
			applied: [],
			problems:
				said.length > 0
					? said
					: ['the patch script exited with status ' + String(result.status) + ' and said nothing'],
		};
	} catch (error) {
		return {
			applied: [],
			problems: [
				'could not run the patch script: ' + (error instanceof Error ? error.message : String(error)),
			],
		};
	}
}
