# Revert Pi UI overrides: chat, responses and prompt field

## Goal

Stop overriding Pi's own UI in the transcript and the editor, so the chat and the
prompt field render exactly as Pi ships them. The LOON identity (theme, palette,
startup banner, exit banner, status line, wallpaper accent) stays.

## Scope decided with the user

| Area | Decision |
| :--- | :--- |
| Frames around assistant replies, user messages and tool output | **Remove** |
| Animated spinner, `✻ Worked for Ns` turn footer, thinking transformer | **Remove** |
| Grouped tool calls and CC-style diff cards | **Remove** |
| Custom prompt editor (`prompt-editor.ts`) | **Remove** |
| Gentle rail layout patches, header suppression, model-panel and resume-selector decoration, fast-mode badge | **Keep** |

Modules were left on disk and simply not registered, so a revert was one import.
Deleting them was offered and declined at the time.

**Superseded.** The extraction manifest (`odd/extraction-manifest.md`) deletes them:
they are unreachable from `extension/index.ts`, and carrying them into the new
capability repositories would mean maintaining dead code in four places. A revert
is now `git revert` of the deletion commit, not an import.

## Tasks

- [x] Unregister the chat modules in `extension/index.ts`
- [x] Remove the transcript framing overrides from `extension/host-patches.ts`, keeping every rail patch intact
- [x] Remove the commands and shortcuts that only drove the removed features
- [x] Run the test suite and build the package
- [x] Verify visually in a real PTY that the defaults are back
- [x] Commit the work unit

## Why this is not a straight module deletion

`host-patches.ts` holds two unrelated jobs: the rail/layout workarounds the user
chose to keep, and the transcript framing being removed. Only the framing leaves.
The same file also bridges `TRANSCRIPT_THEME` and the image-occlusion handlers,
which the kept patches read.

## Evidence

- Tests: `node --experimental-strip-types --test extension/*.test.ts` → 75 tests, 75 pass, 0 fail.
- Build: `nix build` → `/nix/store/cyk45h2zfx5zvcarfapmfx08f2bym4z6-loon-0.1.9`.
- Diff: 3 files, 15 insertions, 568 deletions.
- Live PTY run, one real turn:
  - zero occurrences of `┌─ Respuesta`, `┌─ loonbac`, `┌─ bash` and `└─`;
  - the reply rendered as a bare `ok` line, with no frame;
  - no theme or load error;
  - the LOON banner and the `✻ LOON — 57s` exit recap still render.
- Every symbol the writer removed was grepped afterwards: 0 remaining references, and the kept
  workarounds (`ccUiBlankMessageRender`, `ccUiFilteredShowStatus`, the rail and header patches,
  `sharedHostState[TRANSCRIPT_THEME]`) are all still present.

## Known limit

The prompt pointer `❯` and the `▎` rail still appear, but they are not ours: gentle-pi's
`extensions/gentle-shell.ts:1120` calls `ctx.ui.setEditorComponent(factory)`. Removing our own
`prompt-editor.ts` was all this extension could do. A truly stock editor would require disabling
Gentle Shell's editor, which is a separate decision.
