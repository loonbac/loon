/**
 * The patch targets, for the startup path.
 *
 * `scripts/gentle-pi-patch.ts` holds the real anchors, and it stays the single source of
 * truth: it is the thing a person runs, it takes backups, it refuses on drift and it
 * validates the result. Importing it here would drag a command-line tool with its
 * `createRequire`, its jiti probe and its `process.exitCode` into pi's boot for the sake
 * of a table, so this module restates the *shape* and leaves the application to the script.
 *
 * The two cannot drift silently: `tests/patch-targets.test.ts` imports the script and
 * fails if the file list here is not exactly the file list there. Adding a target to one
 * without the other is a red test, not a surprise at a person's next start.
 */
import type { PatchableTarget } from './patch-target.ts';

/**
 * Every file the patch edits, in the order the script declares them.
 *
 * The anchors themselves are not duplicated: `patch-target.ts` reads a target's edits, and
 * the repair takes them from the script's own table at the moment it runs (see
 * `patchTargetsFor`), so a moved anchor is refused by the same rule the script uses.
 */
export const PATCHED_FILES: readonly string[] = [
	'extensions/gentle-shell.ts',
	'lib/visual-customize-view.ts',
	'extensions/startup-banner.ts',
	'lib/shell-bar.ts',
	'lib/shell-card.ts',
	'lib/card-style-policy.ts',
	'lib/shell-prompt.ts',
	// Peer labels: the recipient picker and the orchestrator_list rows show a readable
	// identity instead of a raw session id, and a session that cannot ask a person
	// resolves its own recipient.
	'extensions/gentle-agents.ts',
	// Peer repair: a written frame is delivered even when the ACK is lost, on both
	// transports, and one unreadable presence header no longer blanks every peer label.
	'lib/agents-session-transport.ts',
	'lib/windows-session-transport.ts',
	'lib/orchestrator-discovery.ts',
];

/**
 * A target per listed file, with no edits.
 *
 * The edits are empty on purpose. The authoritative anchors live in the script, and a
 * repair run by the startup path must not use a second copy that can fall behind: the
 * caller passes the script's own table where it has one, and where it does not, an empty
 * edit list makes `repairVerdict` answer `refused` for a file that needs patching — a
 * visible problem — rather than write a guess. `tests/patch-targets.test.ts` holds the two
 * lists together.
 */
export function targetsFor(_install: string): PatchableTarget[] {
	return PATCHED_FILES.map((file) => ({ file, edits: [] }));
}
