# Beads Setup Guide

Setup guide for **bd** (Beads) — a git-backed issue tracker designed for AI coding agents.

GitHub: https://github.com/steveyegge/beads

## 1. Install the CLI

Pick one method (Homebrew is easiest on macOS):

```bash
# Homebrew (macOS/Linux)
brew install beads

# npm (any platform with Node.js)
npm install -g @beads/bd

# Go
go install github.com/steveyegge/beads/cmd/bd@latest
```

Verify:

```bash
bd --version
# bd version 0.52.0 (Homebrew)
```

## 2. Initialize in your project

```bash
cd your-project
bd init
```

This creates:
- `.beads/` directory with a Dolt database for issue storage
- `.beads/config.yaml` for project-level settings
- `.beads/hooks/` for git hook scripts
- `AGENTS.md` with instructions that AI agents pick up automatically

Issues are auto-prefixed with the directory name (e.g. `GenreTagging-a3f2`).

### Fix: stale LOCK file

If `bd init` reports a Dolt connection error, remove the stale lock:

```bash
rm .beads/dolt/<database_name>/.dolt/noms/LOCK
bd status   # should now show "Total Issues: 0"
```

## 3. Install git hooks

```bash
bd hooks install
```

Installs hooks for: `pre-commit`, `post-merge`, `pre-push`, `post-checkout`, `prepare-commit-msg`. These auto-sync the JSONL backup with git operations so issues stay in sync across machines.

## 4. Set up Claude Code integration

```bash
bd setup claude
```

This adds two hooks to `~/.claude/settings.json`:
- **SessionStart** — injects Beads workflow context when Claude Code starts a session
- **PreCompact** — preserves context before conversation compaction

Restart Claude Code after this step for hooks to take effect.

## 5. Update your project's CLAUDE.md

Add an Issue Tracking section so Claude knows to use Beads:

```markdown
## Issue Tracking
This project uses **bd** (Beads) for issue tracking. See `AGENTS.md` for workflow details.
- `bd ready` — list tasks with no open blockers
- `bd create "Title" -p <priority>` — create a task (P0=critical, P1=high, P2=normal, P3=low)
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- Include issue ID in commit messages: `git commit -m "Fix bug (ProjectName-abc)"`
```

## 6. Run the health check

```bash
bd doctor
```

Key checks to pass:
- **Dolt Connection** — database is accessible
- **Git hooks** — installed and executable
- **Claude Integration** — hooks registered

Safe to ignore (for single-user local projects):
- **Sync Branch Config** — only needed for multi-clone setups
- **Federation** warnings — for multi-repo coordination
- **Claude Plugin** — optional marketplace plugin, CLI hooks are sufficient

## Quick reference

| Command | What it does |
|---------|-------------|
| `bd ready` | Show issues with no open blockers |
| `bd create "Title" -p 2` | Create a P2 (normal) task |
| `bd create "Title" -p 0 -t bug` | Create a critical bug |
| `bd show <id>` | View issue details and dependencies |
| `bd update <id> --status in_progress` | Claim work |
| `bd close <id>` | Mark complete |
| `bd list` | List all issues |
| `bd list --status open` | List open issues only |
| `bd dep add <child> <parent>` | child depends on parent |
| `bd blocked` | Show all blocked issues |
| `bd status` | Database overview and stats |
| `bd sync` | Sync with git (run at session end) |
| `bd doctor` | Health check |

### Priority levels

| Priority | Meaning |
|----------|---------|
| P0 | Critical — drop everything |
| P1 | High — do soon |
| P2 | Normal (default) |
| P3 | Low |
| P4 | Backlog |

### Typical workflow

```bash
# Find work
bd ready

# Start working
bd update GenreTagging-abc --status in_progress

# ... do the work ...

# Finish up
bd close GenreTagging-abc
bd sync
git add . && git commit -m "Fix the thing (GenreTagging-abc)"
git push
```

## What gets committed to git

- `.beads/` directory (config, JSONL backup, hooks) — committed
- `.beads/dolt/` — gitignored (local database, rebuilt from JSONL)
- `.beads/metadata.json` — gitignored (local clone identity)
- `AGENTS.md` — committed (agent instructions)
