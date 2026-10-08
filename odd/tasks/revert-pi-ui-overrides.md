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

Modules are left on disk and simply not registered, so a revert is one import.
Deleting them was offered and declined.

## Tasks

- [ ] Unregister the chat modules in `extension/index.ts`
- [ ] Remove the transcript framing overrides from `extension/host-patches.ts`, keeping every rail patch intact
- [ ] Remove the commands and shortcuts that only drove the removed features
- [ ] Run the test suite and build the package
- [ ] Verify visually in a real PTY that the defaults are back
- [ ] Commit the work unit

## Why this is not a straight module deletion

`host-patches.ts` holds two unrelated jobs: the rail/layout workarounds the user
chose to keep, and the transcript framing being removed. Only the framing leaves.
The same file also bridges `TRANSCRIPT_THEME` and the image-occlusion handlers,
which the kept patches read.

## Evidence

Filled in as each task is actually observed. Nothing is recorded here before it
was run.
