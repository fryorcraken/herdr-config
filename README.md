# herdr-config

My [herdr](https://github.com/herdrdev/herdr-app) customisation: the `my-main` layout, its two mods, and my keys and settings.

| Path | What |
|---|---|
| `layouts/my-main.json` | `main` layout with the sidebar list and tab bar swapped for my mods |
| `mods/my-agents/` | sidebar list: agents and shells, grouping and ordering, rename, hover details |
| `mods/my-tabs/` | tab bar: folder tab names, tooltips |
| `keys.json` | key bindings |
| `settings.json` | app settings |

## Install

```sh
./install.sh --dry   # see what it would do
./install.sh
```

It symlinks each path above into `~/.config/herdr-app` (or `$HERDR_APP_HOME`). What was there is kept in `~/.config/herdr-app/.before-herdr-config/`, not deleted. Running it again changes nothing.

Note it links `keys.json` and `settings.json` too: take those only if you want my bindings and settings.

Links are safe across saves: herdr resolves symlinks before its atomic writes, and finds a mod through a linked folder. Herdr updates only replace the mods and layouts it ships, never `my-*`.

Not here, because herdr owns them: the shipped mods, themes and icons, `*.d.ts` (regenerated), and runtime state (`shared.json`, `view.json`, `window.json`, `layouts/.state/`).

## Remotes

`origin` is GitHub (`fryorcraken/herdr-config`), `rad` is Radicle. Push to both.

## Licence

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.

`mods/my-agents` and `mods/my-tabs` started as copies of herdr's `agents` and `tabs` mods, which are Apache-2.0 ([herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)). `mods/my-agents` also takes its worktree test and space avatars from herdr's `spaces` mod. The parts that came from herdr stay under Apache-2.0.

## PR badge

Each Claude Code agent's row in the sidebar shows the pull request its session
opened, colored by state: green for open, grey for draft, purple for merged, red
for closed. A red dot means an open PR's checks are failing. Hover over the icon
for the PR's number and title, or click it to open the PR.
`mods/my-agents/prs.py` works this out every 90 s from Claude Code's session
files, with one `gh api graphql` request. So it needs `gh` logged in. OpenCode
sessions get no badge yet.

## Worktrees

Grouped by space, a worktree space goes under the space of its main checkout,
as herdr's Spaces list nests it: each worktree's rows sit under a line with a
branch icon and its name. It's the Spaces list's own test, git's
`--git-common-dir` for each space's folder, so the two lists agree. A worktree
whose main checkout has no space keeps a header of its own.

The Status order puts rows that need you first, then the done ones you haven't
looked at (blue dot), then working, then idle; ties keep tab order. Under a
space it sorts the space's rows and its worktrees' together, and the worktree
lines follow the rows, so a worktree that needs you comes first. The space's own
rows, when they come after a worktree's, get a line with the space's avatar.
