# AGENTS.md

## What This Is

BUPT campus website automation scripts using Cursor Agent Skills + CDP browser automation. Not a web app—no build step, no package.json, no tests, no bundler.

## Architecture

- `bupt-ucloud/` — scripts for ucloud.bupt.edu.cn (teaching platform)
- `bupt-ucloud/SKILL.md` — Cursor Skill definition + full technical docs (read this first)
- `bupt-ucloud/scripts/*.mjs` — standalone Node.js scripts, each executable via `node <script>.mjs`

## Runtime Requirements

- **Node.js 22+** (uses native `fetch`)
- **CDP Proxy** running on `localhost:3456` (provided by [web-access skill](https://github.com/cursor-ide/web-access))
- Chrome with remote debugging enabled (`chrome://inspect/#remote-debugging`)

## Script Conventions

- Exit codes: `0` = success, `1` = failure (stderr has reason), `2` = env/arg error
- All scripts talk to CDP Proxy at `http://localhost:3456` via `fetch`
- `--json` flag on most list scripts outputs machine-readable JSON
- `${SKILL_DIR}` in SKILL.md refers to the `bupt-ucloud/` directory when running as a Cursor skill

## Key Technical Quirks

These are documented in `bupt-ucloud/SKILL.md` but easy to miss:

- Login form lives inside `<iframe id="loginIframe">` — must use `iframe.contentDocument` and `iframe.contentWindow` for events/prototypes
- SPA pages: `ready:complete` doesn't mean data is rendered — add `sleep(1000)` after ready-check before extracting data
- el-table: titles are in `.el-table__fixed` fixed columns; filter out `is-hidden` class tds
- Course switching: must navigate from `index.html` via card click (SPA reads `localStorage.site` only on initial load)
- Download URLs: intercepted via `window.open` override, require `sleep(4000)` after click
- Course CDN URLs (`fileucloud.bupt.edu.cn`) are public — no auth needed for download

## Running Scripts

```bash
# Login
node bupt-ucloud/scripts/login.mjs <student_id> <password> [service_url]

# List courses
node bupt-ucloud/scripts/list-courses.mjs [--json]

# View pending tasks
node bupt-ucloud/scripts/list-pending-tasks.mjs [--json]

# Download courseware
node bupt-ucloud/scripts/list-course-files.mjs <course_name_keyword> [--json]
node bupt-ucloud/scripts/download-course-file.mjs <course_name> <file_keyword> [save_dir]

# Submit assignment (pauses for user confirmation before final submit)
node bupt-ucloud/scripts/submit-assignment.mjs <assignment_keyword> <file_path> [--comment <text>]
```

## Adding New Scripts

Follow the existing pattern: `#!/usr/bin/env node`, use the same `PROXY` constant and `request()` helper pattern seen in all scripts. No shared utilities module exists—each script is self-contained.
