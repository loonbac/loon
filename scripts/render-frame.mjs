#!/usr/bin/env node
// Turn a probe-frame capture into a PNG, colours included.
//
// probe-frame.sh --sgr writes the frame exactly as pi painted it: truecolor SGR
// runs and text. ImageMagick cannot read ANSI, so this walks the capture, keeps
// the colour state each character was drawn with, and emits an SVG that `magick`
// rasterises. No desktop capture, so the picture is deterministic and contains
// nothing but the frame.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , input, output, ...flags] = process.argv;
if (input === undefined || output === undefined) {
	console.error('usage: render-frame.mjs <frame.txt> <out.png> [--cell 9] [--font 15]');
	process.exit(2);
}
const opt = (name, fallback) => {
	const at = flags.indexOf('--' + name);
	return at >= 0 ? Number(flags[at + 1]) : fallback;
};
const FONT = opt('font', 16);
const CELL = opt('cell', Math.round(FONT * 0.6));
const LINE = Math.round(FONT * 1.38);
const PAD = Math.round(FONT * 0.9);
const BG = '#0d1117';
const FG = '#d7dde8';

/** Display width in cells: the frame is mostly box drawing, plus a few wide glyphs. */
function cells(char) {
	const cp = char.codePointAt(0);
	if (cp === undefined) return 1;
	const wide =
		(cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff);
	return wide ? 2 : 1;
}

const source = readFileSync(input, 'utf8').replace(/\r/g, '').replace(/\x00/g, '');
const rows = [];
for (const raw of source.split('\n')) {
	// One row of runs: [text, fill, weight, background]
	const runs = [];
	let fill = FG;
	let bold = false;
	let back = undefined;
	const push = (text) => {
		if (text.length === 0) return;
		const last = runs[runs.length - 1];
		if (last !== undefined && last.fill === fill && last.bold === bold && last.back === back) last.text += text;
		else runs.push({ text, fill, bold, back });
	};
	let at = 0;
	const sgr = /\x1b\[([0-9;]*)m/y;
	while (at < raw.length) {
		sgr.lastIndex = at;
		const match = sgr.exec(raw);
		if (match !== null) {
			const params = match[1] === '' ? [0] : match[1].split(';').map(Number);
			for (let index = 0; index < params.length; index += 1) {
				const code = params[index];
				if (code === 0) { fill = FG; bold = false; back = undefined; }
				else if (code === 1) bold = true;
				else if (code === 22) bold = false;
				else if (code === 39) fill = FG;
				else if (code === 49) back = undefined;
				else if (code === 38 && params[index + 1] === 2) { fill = `rgb(${params[index + 2]},${params[index + 3]},${params[index + 4]})`; index += 4; }
				else if (code === 48 && params[index + 1] === 2) { back = `rgb(${params[index + 2]},${params[index + 3]},${params[index + 4]})`; index += 4; }
				else if (code >= 30 && code <= 37) fill = ['#3b4048', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d7dde8'][code - 30];
				else if (code >= 90 && code <= 97) fill = ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'][code - 90];
			}
			at = sgr.lastIndex;
			continue;
		}
		// Any other escape sequence: skip it, keep nothing.
		const other = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(raw.slice(at));
		if (other !== null) { at += other[0].length; continue; }
		const cp = raw.codePointAt(at);
		const char = String.fromCodePoint(cp);
		push(char);
		at += char.length;
	}
	rows.push(runs);
}

const columns = Math.max(...rows.map((runs) => runs.reduce((total, run) => total + [...run.text].reduce((n, ch) => n + cells(ch), 0), 0)));
const width = columns * CELL + PAD * 2;
const height = rows.length * LINE + PAD * 2;
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
svg += `<rect width="100%" height="100%" fill="${BG}"/>`;
rows.forEach((runs, row) => {
	let column = 0;
	const y = PAD + (row + 1) * LINE - Math.round(LINE * 0.28);
	for (const run of runs) {
		const runCells = [...run.text].reduce((n, ch) => n + cells(ch), 0);
		if (run.back !== undefined) {
			svg += `<rect x="${PAD + column * CELL}" y="${PAD + row * LINE}" width="${runCells * CELL}" height="${LINE}" fill="${run.back}"/>`;
		}
		svg += `<text x="${PAD + column * CELL}" y="${y}" fill="${run.fill}" font-family="DejaVu Sans Mono, monospace" font-size="${FONT}"${run.bold ? ' font-weight="bold"' : ''} xml:space="preserve">${escape(run.text)}</text>`;
		column += runCells;
	}
});
svg += '</svg>';

const svgPath = output.replace(/\.png$/, '.svg');
writeFileSync(svgPath, svg);
execFileSync('magick', ['-background', BG, svgPath, '-flatten', '-resize', '200%', output]);
console.log(`${output} · ${width}×${height} cells ${columns}×${rows.length} · svg ${svgPath}`);
