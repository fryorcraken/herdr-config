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

It symlinks each path above into `~/.config/herdr-app` (or `$HERDR_APP_HOME`). What was there is moved to `<name>.before-herdr-config`, not deleted.

Links are safe across saves: herdr resolves symlinks before its atomic writes, and finds a mod through a linked folder. Herdr updates only replace the mods and layouts it ships, never `my-*`.

Not here, because herdr owns them: the shipped mods, themes and icons, `*.d.ts` (regenerated), and runtime state (`shared.json`, `view.json`, `window.json`, `layouts/.state/`).

## Remotes

`origin` is GitHub (`fryorcraken/herdr-config`), `rad` is Radicle. Push to both.
