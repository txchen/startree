# Notes UI prototype — not production code

Question: Which layout makes encrypted personal quick notes convenient without crowding the Bookmarks Page?

Run `npm run prototype:notes` in this worktree and open http://127.0.0.1:5190/?notes-prototype=1&variant=A . The development-only prototype is hosted in the existing application shell. The bottom controls switch layouts and show editor, locked, and first-use states. Left/right arrow keys switch layouts outside input fields.

- A: list and editor side by side; separate list/editor screens on mobile. Recommended starting point.
- B: cards with excerpts, opening a detail editor.
- C: focused single editor with a note-switching menu.

All data is synthetic and kept in memory. Unlock, save status, setup, recovery, and deletion are UI simulations. No cryptography, backend calls, storage, timer-based locking, password checking, or recovery-key verification is implemented. Never enter real private content or passwords into this prototype. Fifteen-minute auto-lock is a proposal, not an agreed requirement.

Shared direction: a separate Notes Page beside Bookmarks, plain-text writing, local search, visible save state, manual lock, session unlock, and a separate first-use recovery-key step. Production design must also address save failures, edit conflicts, pending edits during locking, recovery verification, and offline status.

Verdict: awaiting Owner review. Do not promote this prototype or begin production implementation before confirmation. Screenshots capture the concepts for review. The production branch and deployment are unchanged.
