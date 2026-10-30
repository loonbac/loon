# gentle-pi 4.5.1, pristine

The seven source files the patch targets, copied byte for byte from the installed
`gentle-pi` package at version 4.5.1, before any patch is applied.

They exist so `tests/gentle-pi-patch.test.ts` can prove the pinned digests instead of
declaring them: each anchor must occur once, and applying the edits must reproduce
`md5Patched` exactly. Reading the user's install or git history would make the test
depend on the machine; these files make it depend on the bytes the patch was written
against.

```
$ md5sum extensions/gentle-shell.ts lib/shell-prompt.ts
ad1bfce79b655fc4f7cae71449d05d88  extensions/gentle-shell.ts
6dccc1c4bf36e217d308a67c5e690c14  lib/shell-prompt.ts
```

gentle-pi is MIT licensed, Copyright (c) the gentle-pi authors. The files are unmodified
copies kept for verification only; `NOTICE` records the attribution.
