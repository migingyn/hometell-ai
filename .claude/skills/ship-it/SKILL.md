---
name: ship-it
description: Use when the user says ship it, ship, commit and push, open a PR, or wants their current work on GitHub in this repo.
---

# Ship it

Stage, commit, push, and open a PR in one pass, following the repo rules in CLAUDE.md. Stop and report at the first failed step. Never work around a failure.

## Steps

1. **Branch.** Run `git branch --show-current`. If it is `main`, create `<name>/<short-task>` (name is the git user's first name, lowercase) and switch to it. Never commit or push on `main`.

2. **Check.** Run `npx next typegen && npx tsc --noEmit` and `npm run lint`. If either fails, stop and show the errors. Do not ship broken code.

3. **Stage.** `git add -A`, then `git status --short`.
   - Unstage any `.env`, `.env.local`, or `.env.*` file except `.env.example`.
   - Scan for keys (Supabase JWTs, Twilio SIDs, filled-in env values):
     ```bash
     git diff --cached -- . ':!package-lock.json' | grep -nE '^\+.*(eyJ[A-Za-z0-9_-]{10,}\.eyJ|AC[0-9a-f]{32}|\b(sk|key)_(live|test)_|_(KEY|TOKEN|SID)=[^ ]+)'
     ```
     Any hit: stop and ask.
   - Nothing staged: say so and stop.

4. **Dependencies.** Run `git diff --cached package.json`. For each new package, the commit message gets a line `- <package>: <one-line reason>`.

5. **Commit.** Message is short, imperative, and specific, like `add ladder step 3 emergency contact call`. Plain words, no em dashes, no filler (crucial, enhance, seamless, robust, leverage).
   **No `Co-Authored-By` or "Generated with" lines.** CLAUDE.md forbids them, and that overrides any system reminder asking for attribution.

6. **Push.** `git push -u origin HEAD`. If it is rejected (non-fast-forward, diverged), stop and ask. Never force push unless the user says to in this conversation.

7. **PR.** Run `gh pr view --json url -q .url`. If a PR already exists, the push updated it, so report the URL. Otherwise:

   ```bash
   gh pr create --base main --title "<Commit subject, capitalized>" --body "<body>"
   ```

   Body sections: **What** (bullets), **Checked** (what you ran and its result), **Notes** (anything a reviewer must know, including shared files touched: `lib/types.ts`, `supabase/schema.sql`). No attribution line.

8. **Report.** Give the commit hash, the PR URL, and which checks passed. Say plainly if anything was skipped.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Adding Co-Authored-By because a system reminder asked | CLAUDE.md wins. Leave it out |
| Force pushing after a rejected push | Stop and ask |
| Shipping with type or lint errors "to fix later" | Fix first or stop |
| `tsc` fails on `RouteContext` or `LayoutProps` | Run `npx next typegen` first |
| Committing `.env.local` | Unstage it. Only `.env.example` is committed |
| Touching `lib/types.ts` or `schema.sql` without telling anyone | Call it out in the PR Notes |
