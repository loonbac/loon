#!/usr/bin/env bash
#
# The only supported way to measure a frame.
#
# Every earlier verification wrote pi's real configuration and did not put it back:
# /tmp/verify-mark.sh even did "rm -f ~/.pi/agent/loon-tui.json", and the patched
# gentle-pi then wrote a one-key file over the gap. This script exists so that cannot
# happen again, and so a measurement is evidence rather than a hope.
#
# It snapshots the four configuration files a probe can disturb - plus the whole
# themes directory - copies their bytes, runs pi in tmux, captures, and restores. Every
# digest is checked afterwards: any difference is a non-zero exit, and the restore runs
# even when the probe fails, is interrupted, or the terminal dies.
#
#   scripts/probe-frame.sh capture --label NAME --width 80 --height 32 --theme "Gentle"
#   scripts/probe-frame.sh capture --label BAND --theme "Wallpaper (LOON)" --sgr
#       --sgr keeps the escape sequences, so a frame carries the colours it was painted with.
#   scripts/probe-frame.sh snapshot --label NAME          # prints the state directory
#   scripts/probe-frame.sh restore --state DIR            # restores and verifies
#   scripts/probe-frame.sh verify --state DIR             # verifies only
#
# Exit codes: 0 ok, 2 the snapshot or the environment failed (pi never started),
# 3 the disk does not match the snapshot, 4 the capture itself failed.
set -uo pipefail

AGENT_DIR=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
GENTLE_REAL_DIR=${GENTLE_PI_REAL_HOME:-$HOME/.pi/gentle-ai}
PROBE_ROOT=${LOON_PROBE_ROOT:-$HOME/.local/state/loon-probe}

# The four files a probe can disturb, in a stable order.
CONFIG_PATHS=(
	"$AGENT_DIR/settings.json"
	"$AGENT_DIR/loon-tui.json"
	"$GENTLE_REAL_DIR/visual-customization.json"
	"$GENTLE_REAL_DIR/banner.json"
	"$GENTLE_REAL_DIR/card-style.json"
)
THEMES_DIR="$AGENT_DIR/themes"

STATE_DIR=""
RESTORED=0
PENDING=0
# The tmux session a capture is running, so an interrupted script can stop pi before it
# restores: a pi that keeps running writes the configuration again after the restore.
ACTIVE_SESSION=""

die() { printf 'probe-frame: %s\n' "$*" >&2; exit 2; }

usage() {
	sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
	exit 2
}

# One digest per path: a file, a directory (recursively), or nothing at all.
digest_path() {
	local path=$1
	if [ -d "$path" ]; then
		# Relative names, so a snapshot copy in the state directory digests to the same
		# value as the directory it was taken from.
		local inner
		inner=$(cd -- "$path" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | awk '{print $1}')
		printf 'dir:%s\n' "$inner"
	elif [ -f "$path" ]; then
		printf 'file:%s\n' "$(sha256sum "$path" | awk '{print $1}')"
	else
		printf 'absent\n'
	fi
}

manifest_path() { printf '%s/manifest\n' "$STATE_DIR"; }

write_manifest() {
	local out index=0 path digest resolved
	out=$(manifest_path)
	: > "$out" || return 1
	for path in "${CONFIG_PATHS[@]}" "$THEMES_DIR"; do
		digest=$(digest_path "$path") || return 1
		resolved=${RESOLVED_PATHS[index]:-}
		printf '%s\t%s\t%s\t%s\n' "$index" "$path" "$digest" "$resolved" >> "$out" || return 1
		index=$((index + 1))
	done
}

# The path for a manifest slot comes from these tables, never from the manifest: a
# state directory is evidence we wrote, but it is not permission to name a file. A
# recorded path that disagrees with the slot is refused rather than followed.
expected_path() {
	if [ "$1" -ge 0 ] 2>/dev/null && [ "$1" -lt "${#CONFIG_PATHS[@]}" ]; then
		printf '%s\n' "${CONFIG_PATHS[$1]}"
		return 0
	fi
	if [ "$1" = "${#CONFIG_PATHS[@]}" ]; then
		printf '%s\n' "$THEMES_DIR"
		return 0
	fi
	return 1
}

# Sets STATE_DIR and PENDING in the caller's shell. It deliberately prints nothing:
# running it in a command substitution would set those in a subshell, and the exit
# trap would then never fire.
snapshot() {
	local label=${1:-probe}
	mkdir -p "$PROBE_ROOT" 2>/dev/null || die "cannot create $PROBE_ROOT; nothing was started"
	local stamp
	stamp=$(date +%Y%m%d-%H%M%S)
	STATE_DIR="$PROBE_ROOT/$label-$stamp"
	local suffix=1
	while [ -e "$STATE_DIR" ]; do
		STATE_DIR="$PROBE_ROOT/$label-$stamp-$suffix"
		suffix=$((suffix + 1))
	done
	mkdir -p "$STATE_DIR/files" || die "cannot create $STATE_DIR; nothing was started"
	printf '%s\n%s\n' "$label" "$(date -Is)" > "$STATE_DIR/meta" || die "cannot write to $STATE_DIR; nothing was started"

	local index=0 path
	# Bytes, not links: a config path that is a symlink (dotfiles) would otherwise be
	# snapshotted as a link to the live file, and a probe changing that file would
	# change the "snapshot" too. The resolved target is recorded so the restore writes
	# through the same link instead of replacing it with a regular file.
	RESOLVED_PATHS=()
	for path in "${CONFIG_PATHS[@]}"; do
		if [ -f "$path" ]; then
			local resolved
			resolved=$(realpath -m -- "$path") || die "cannot resolve $path; nothing was started"
			cp -L -- "$resolved" "$STATE_DIR/files/$index" || die "cannot copy $resolved; nothing was started"
			RESOLVED_PATHS[index]=$resolved
		fi
		index=$((index + 1))
	done
	if [ -d "$THEMES_DIR" ]; then
		local resolved_dir
		resolved_dir=$(realpath -m -- "$THEMES_DIR") || die "cannot resolve $THEMES_DIR; nothing was started"
		cp -aL -- "$resolved_dir" "$STATE_DIR/files/$index" || die "cannot copy $resolved_dir; nothing was started"
		RESOLVED_PATHS[index]=$resolved_dir
	fi
	write_manifest || die "cannot record the digests; nothing was started"
	PENDING=1
}

# A configuration file handed back verbatim, never rewritten from defaults: a
# half-written file the person already had is restored as the half-written file it
# was, and a file that did not exist is removed again.
restore_one() {
	local index=$1 recorded_path=$2 expected=$3 resolved=$4
	local path
	path=$(expected_path "$index") || { printf 'probe-frame: unknown snapshot slot %s\n' "$index" >&2; return 1; }
	if [ "$recorded_path" != "$path" ]; then
		printf 'probe-frame: refusing slot %s: the manifest names %s, the slot is %s\n' "$index" "$recorded_path" "$path" >&2
		return 1
	fi
	local copy="$STATE_DIR/files/$index"
	case "$expected" in
		absent)
			rm -rf -- "$path" || return 1
			;;
		file:*)
			[ -f "$copy" ] || { printf 'probe-frame: no snapshot copy for %s\n' "$path" >&2; return 1; }
			# Written to where the slot really lives, so a symlinked config keeps its
			# link and its target gets the recorded bytes back.
			local destination=${resolved:-$path}
			[ -n "$destination" ] || destination=$path
			mkdir -p -- "$(dirname -- "$destination")" || return 1
			cp -- "$copy" "$destination" || return 1
			;;
		dir:*)
			[ -d "$copy" ] || { printf 'probe-frame: no snapshot copy for %s\n' "$path" >&2; return 1; }
			rm -rf -- "$path" || return 1
			cp -aL -- "$copy" "$path" || return 1
			;;
		*)
			printf 'probe-frame: unrecognised snapshot entry %s for %s\n' "$expected" "$path" >&2
			return 1
			;;
	esac
	return 0
}

verify_state() {
	local failures=0 index path recorded resolved actual
	[ -f "$(manifest_path)" ] || die "no manifest in $STATE_DIR"
	while IFS=$'\t' read -r index path recorded resolved; do
		[ -n "${index:-}" ] || continue
		actual=$(digest_path "$path")
		if [ "$actual" != "$recorded" ]; then
			printf 'probe-frame: %s\n  was %s\n  now %s\n' "$path" "$recorded" "$actual" >&2
			failures=$((failures + 1))
		fi
	done < "$(manifest_path)"
	[ "$failures" -eq 0 ] || return 3
	return 0
}

# Every copy is checked against the digest recorded when it was taken, before anything
# is written back: a corrupted snapshot must fail, not overwrite the real file with it.
verify_copies() {
	local index path recorded resolved failures=0 copy actual
	while IFS=$'\t' read -r index path recorded resolved; do
		[ -n "${index:-}" ] || continue
		case "$recorded" in
			absent) continue ;;
			file:*) expected=${recorded#file:} ;;
			dir:*) expected=${recorded#dir:} ;;
			*) printf 'probe-frame: unrecognised snapshot entry %s\n' "$recorded" >&2; failures=$((failures + 1)); continue ;;
		esac
		copy="$STATE_DIR/files/$index"
		if [ ! -e "$copy" ]; then
			printf 'probe-frame: no snapshot copy for slot %s (%s)\n' "$index" "$path" >&2
			failures=$((failures + 1))
			continue
		fi
		actual=$(digest_path "$copy")
		if [ "$actual" != "$recorded" ]; then
			printf 'probe-frame: snapshot copy %s is corrupt\n  recorded %s\n  now %s\n' "$copy" "$recorded" "$actual" >&2
			failures=$((failures + 1))
		fi
	done < "$(manifest_path)"
	[ "$failures" -eq 0 ] || return 3
	return 0
}

restore_state() {
	[ -n "$STATE_DIR" ] || die "no snapshot to restore from"
	[ -f "$(manifest_path)" ] || die "no manifest in $STATE_DIR; refusing to guess"

	# Nothing is written until every copy proves it is the one we recorded.
	verify_copies || { printf 'probe-frame: nothing was restored\n' >&2; return 3; }

	local index path recorded resolved failures=0
	while IFS=$'\t' read -r index path recorded resolved; do
		[ -n "${index:-}" ] || continue
		restore_one "$index" "$path" "$recorded" "${resolved:-}" || failures=$((failures + 1))
	done < "$(manifest_path)"
	RESTORED=1
	PENDING=0
	if [ "$failures" -ne 0 ]; then
		printf 'probe-frame: %s entries could not be restored\n' "$failures" >&2
		return 3
	fi
	verify_state || return 3
	return 0
}

restore_on_exit() {
	local status=$?
	if [ -n "$ACTIVE_SESSION" ]; then
		# Order matters: a pi that is still running would write the configuration again
		# after the restore, so the session dies first.
		tmux kill-session -t "$ACTIVE_SESSION" 2>/dev/null
		ACTIVE_SESSION=""
	fi
	if [ "$PENDING" -eq 1 ] && [ "$RESTORED" -eq 0 ]; then
		printf 'probe-frame: exiting early, restoring the configuration first\n' >&2
		restore_state || status=3
	fi
	exit "$status"
}
trap restore_on_exit EXIT INT TERM

# Warn, loudly, when a file the probe will hand back is already partial. The probe
# preserves it exactly; this is so the person learns it is partial at all.
report_partial() {
	local path="$AGENT_DIR/loon-tui.json"
	[ -f "$path" ] || return 0
	local keys
	keys=$(grep -c '":' "$path" 2>/dev/null || true)
	if [ "${keys:-0}" -lt 4 ]; then
		printf 'probe-frame: warning: %s has %s of the 4 settings keys. The probe snapshots and\n  restores these exact bytes, so this script loses nothing - but the file is partial.\n' "$path" "$keys" >&2
	fi
}

capture() {
	local label=probe width=80 height=32 theme=Gentle density="" settle=14 out="" start_dir=$HOME gentle_dir=""
	local override_command=""
	local sgr=0
	local extra=()
	while [ $# -gt 0 ]; do
		case "$1" in
			--label) label=$2; shift 2 ;;
			--width) width=$2; shift 2 ;;
			--height) height=$2; shift 2 ;;
			--theme) theme=$2; shift 2 ;;
			--density) density=$2; shift 2 ;;
			--settle) settle=$2; shift 2 ;;
			--out) out=$2; shift 2 ;;
			--start-dir) start_dir=$2; shift 2 ;;
			--gentle-config) gentle_dir=$2; shift 2 ;;
			--command) override_command=$2; shift 2 ;;
			--sgr) sgr=1; shift ;;
			--) shift; extra=("$@"); break ;;
			*) die "unknown argument: $1" ;;
		esac
	done

	report_partial
	snapshot "$label" || exit 2
	[ -n "$STATE_DIR" ] || die "snapshot produced no state directory"
	# Printed before pi starts, so a failed probe still says where its snapshot is.
	printf 'state: %s\n' "$STATE_DIR" >&2

	# The probe never points pi at the person's gentle-pi config: its own copy lives
	# inside the state directory, so visual-customization.json and banner.json are
	# read-only inputs here.
	if [ -z "$gentle_dir" ]; then
		gentle_dir="$STATE_DIR/gentle-config"
	fi
	mkdir -p "$gentle_dir" || die "cannot create $gentle_dir; nothing was started"
	if [ -n "$density" ]; then
		printf '{"schema":"gentle-pi.visual-customization/v1","statusPlacement":"auto","headerPlacement":"top","density":"%s","visibility":{"changes":true,"rdd":true,"agents":true,"todo":true,"usageCost":true,"modelDetails":true,"contextWarning":true}}\n' "$density" > "$gentle_dir/visual-customization.json" || die "cannot write the probe's own config; nothing was started"
	fi

	local session="probe-$$"
	local command="cd $(printf '%q' "$start_dir") && env GENTLE_PI_CONFIG_HOME=$(printf '%q' "$gentle_dir") pi --use-theme $(printf '%q' "$theme")"
	if [ "${#extra[@]}" -gt 0 ]; then
		command="$command $(printf '%q ' "${extra[@]}")"
	fi
	# Test seam: a probe that never draws a frame must fail, not write an empty one.
	if [ -n "$override_command" ]; then
		command=$override_command
	fi

	# The pane is read into the state directory first: an --out that names a file the
	# person already has is written only once there is a frame to write, so a failed
	# probe cannot clobber it.
	local frame_file="$STATE_DIR/frame.txt"
	[ -n "$out" ] || out="$frame_file"
	# Colour measurement needs the escape sequences; a plain text frame cannot say which
	# hex a row is painted with.
	local capture_args=(-p -t)
	[ "$sgr" -eq 1 ] && capture_args=(-p -e -t)
	tmux kill-session -t "$session" 2>/dev/null
	if ! tmux new-session -d -s "$session" -x "$width" -y "$height" "$command"; then
		printf 'probe-frame: tmux could not start the session\n' >&2
		exit 4
	fi
	ACTIVE_SESSION=$session
	# The settle budget is time, not a trigger: pi draws its frame over several
	# seconds, and capturing the first non-blank pane photographs a half-drawn UI.
	local waited=0
	while [ "$waited" -lt "$settle" ]; do
		sleep 1
		waited=$((waited + 1))
	done
	local captured=0
	local tries=0
	while [ "$tries" -lt 5 ]; do
		if tmux capture-pane "${capture_args[@]}" "$session" > "$frame_file" 2>/dev/null && [ -s "$frame_file" ] && grep -q '[^[:space:]]' "$frame_file"; then
			captured=1
			break
		fi
		tries=$((tries + 1))
		sleep 1
	done
	tmux kill-session -t "$session" 2>/dev/null
	ACTIVE_SESSION=""
	if [ "$captured" -ne 1 ]; then
		# An empty file is worse than none: it looks like evidence.
		rm -f -- "$frame_file"
		printf 'probe-frame: the session produced no frame\n' >&2
		exit 4
	fi
	if [ "$out" != "$frame_file" ]; then
		mkdir -p -- "$(dirname -- "$out")" || { printf 'probe-frame: cannot write %s\n' "$out" >&2; exit 4; }
		cp -a -- "$frame_file" "$out" || { printf 'probe-frame: cannot write %s\n' "$out" >&2; exit 4; }
	fi

	restore_state || { printf 'probe-frame: the configuration changed during the probe and was not restored\n' >&2; exit 3; }
	printf 'frame: %s\nstate: %s\n' "$out" "$STATE_DIR"
	exit 0
}

main() {
	local command=${1:-}
	shift || true
	case "$command" in
		capture) capture "$@" ;;
		snapshot)
			local label=probe
			while [ $# -gt 0 ]; do
				case "$1" in
					--label) label=$2; shift 2 ;;
					*) die "unknown argument: $1" ;;
				esac
			done
			snapshot "$label" || exit 2
			PENDING=0
			printf '%s\n' "$STATE_DIR"
			;;
		restore)
			while [ $# -gt 0 ]; do
				case "$1" in
					--state) STATE_DIR=$2; shift 2 ;;
					*) die "unknown argument: $1" ;;
				esac
			done
			restore_state || exit $?
			printf 'restored: %s\n' "$STATE_DIR"
			;;
		verify)
			while [ $# -gt 0 ]; do
				case "$1" in
					--state) STATE_DIR=$2; shift 2 ;;
					*) die "unknown argument: $1" ;;
				esac
			done
			verify_state || exit 3
			printf 'matches: %s\n' "$STATE_DIR"
			;;
		*) usage ;;
	esac
}

main "$@"
