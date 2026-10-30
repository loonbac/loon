#!/usr/bin/env node
/**
 * Close the inline job.
 *
 * LOON draws the parent's inline work as one card in the Agents panel, and a card
 * is the work the person asked for - not one per turn. Only the agent knows when
 * that work is done, so the agent has to say so. This is the cheapest way to say
 * it: run this script, and the extension closes the job on its next event, with
 * the accumulated transcript, the totals and the reason recorded as the agent's
 * own signal.
 *
 *   node scripts/inline-job.mjs end              close the job of this pi session
 *   node scripts/inline-job.mjs end --session ID close the job of another one
 *   node scripts/inline-job.mjs status           what jobs are open right now
 *
 * The script writes one small file next to the carrier, <sessionId>.close.json,
 * and the extension consumes it. That is deliberate: this package must not need
 * to talk to a running pi over a socket, and a file is a signal a reboot cannot
 * fake.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join('state', 'loon-inline');
const USAGE = [
	'node scripts/inline-job.mjs <end|status> [--session <session id>]',
	'',
	'  end      signal that the inline work is finished, so the card closes as completed',
	'  status   print the jobs that are open right now',
].join('\n');

/** The agent home, resolved the same way the extension resolves it. */
function agentHome(env = process.env) {
	return env.GENTLE_PI_AGENT_HOME || env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
}

function stateDir(home) {
	return join(home, STATE_DIR);
}

/** Every carrier file on disk, parsed, unreadable ones skipped. */
function carriers(home) {
	const dir = stateDir(home);
	if (!existsSync(dir)) return [];
	const found = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.json') || name.endsWith('.close.json') || name.endsWith('.thread.json')) continue;
		try {
			const record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
			if (typeof record === 'object' && record !== null && typeof record.id === 'string' && typeof record.parentSessionId === 'string') {
				found.push(record);
			}
		} catch {
			// A file being written is not a reason to fail a command.
		}
	}
	return found;
}

/** The pids this process descends from, so we can find the pi that owns it. */
function ancestors() {
	const seen = new Set();
	let pid = process.pid;
	for (let hop = 0; hop < 64; hop += 1) {
		seen.add(pid);
		let stat;
		try {
			stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
		} catch {
			break;
		}
		// The command name can contain spaces and parentheses: ppid is after the last ')'.
		const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
		const parent = Number(tail[1]);
		if (!Number.isInteger(parent) || parent <= 1 || seen.has(parent)) break;
		pid = parent;
	}
	return seen;
}

/** Which session is asking: the flag, pi's own env var, or the pi above us. */
function resolveSession(home, explicit) {
	if (typeof explicit === 'string' && explicit.length > 0) return { sessionId: explicit, how: '--session' };
	const fromEnv = process.env.PI_SESSION_ID;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return { sessionId: fromEnv, how: 'PI_SESSION_ID' };
	const ancestorsOfThis = ancestors();
	const mine = carriers(home).filter((record) => typeof record.pid === 'number' && ancestorsOfThis.has(record.pid));
	if (mine.length === 1) return { sessionId: mine[0].parentSessionId, how: 'the pi process above this command' };
	if (mine.length > 1) {
		return {
			error:
				'more than one pi session is above this command: ' +
				mine.map((record) => record.parentSessionId).join(', ') +
				'. Pass --session <id> to say which one.',
		};
	}
	return { error: 'this command is not running under a pi session with inline work; pass --session <id> to say which one.' };
}

function parseArgs(argv) {
	const options = { command: 'end', session: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === 'end' || value === 'status') options.command = value;
		else if (value === '--session') {
			const given = argv[index + 1];
			if (given === undefined || given.startsWith('-')) throw new Error('--session needs a session id');
			options.session = given;
			index += 1;
		} else if (value === '--help' || value === '-h') options.command = 'help';
		else if (value.startsWith('-')) throw new Error('unknown option: ' + value);
		else throw new Error('unknown command: ' + value);
	}
	return options;
}

export function main(argv = process.argv.slice(2), env = process.env) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error('inline job: ' + (error instanceof Error ? error.message : String(error)));
		console.error(USAGE.split('\n')[0]);
		return 1;
	}
	if (options.command === 'help') {
		console.log(USAGE);
		return 0;
	}
	const home = agentHome(env);
	const resolved = resolveSession(home, options.session);
	if (resolved.error !== undefined) {
		console.error('inline job: ' + resolved.error);
		return 1;
	}
	const sessionId = resolved.sessionId;

	if (options.command === 'status') {
		const open = carriers(home).filter((record) => record.status === 'running');
		if (open.length === 0) {
			console.log('no inline job is running');
			return 0;
		}
		for (const record of open) {
			console.log(
				[record.id, record.parentSessionId, record.status, record.tokens + ' tokens', '$' + (record.cost ?? 0).toFixed(3), record.lastStep]
					.join('  ·  '),
			);
		}
		return 0;
	}

	const dir = stateDir(home);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, sessionId + '.close.json');
	writeFileSync(path, JSON.stringify({ at: Date.now(), by: 'agent' }), { mode: 0o600 });
	const open = carriers(home).find((record) => record.parentSessionId === sessionId && record.status === 'running');
	console.log(
		open === undefined
			? 'signalled completion for session ' + sessionId + '; there is no running job to close'
			: 'signalled completion for ' + open.id + '; the panel closes it as completed on the next event',
	);
	return 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href;
if (invokedDirectly) process.exitCode = main();
