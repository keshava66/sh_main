# Design: Pipeline Studio

Clean light SaaS tool, held to the craft level of Linear, Vercel and Stripe dashboards. Styles live in `frontend/src/pages/PipelineValidation.jsx` (`PANE_CSS`, `PANEL_CSS`, `PAGE_CSS`), scoped under `.ss-root`.

## Scene
Engineers, QA and leads on Windows cloud desktops in office light, often at 125-150% scaling. Light UI, dense but calm.

## Type
- Geist Variable for everything (`--sans`), Geist Mono Variable for code, IDs and raw values only (`--mono`). Both self-hosted via `@fontsource-variable/*`.
- Base 13px. Row names 13.5px/550, page name 15px/600, detail title 20px/600, search 14.5px.
- Labels are sentence case. No all-caps eyebrows, no tracked micro labels.

## Colour (Restrained)
| Token | Value | Job |
|---|---|---|
| `--ink` | #18181b | text, active tab underline |
| `--ink-2` / `--ink-3` | #3f3f46 / #6b6b74 | secondary / tertiary text |
| `--line` / `--line-2` | #ebebee / #dcdce1 | dividers / control borders |
| `--wash` / `--wash-2` | #fafafa / #f4f4f5 | hover rows, group bands / chips |
| `--red` (accent, historic name) | #5b5bd6 | primary buttons, selection, focus, progress |
| `--ok` / `--bad` / `--warn` | #1a7f37 / #cf222e / #9a6700 | state |

Result badges (`.ss-badge.is-*`): pass green, critical red, faulty orange, error magenta, warning amber, not found olive, running accent. Always dot + word, never colour alone.
Sources: Oracle #c2410c, MariaDB #2563c9, SQL Server #7c3aed (small square swatch + name).

## Layout
- Top bar 52px: mark, name, Control Hub host | extractor status, sync time, reload, Jump (Ctrl K).
- Search is the primary control (44px, max 720px), with the health line (passing count + one stacked bar) on the right.
- Status tabs scope the list (`?sslane=`); label and group-by selects on the right.
- List, not cards: sticky column header, grouped bands (foldable), 56px rows with name + description, source, last result, changed, version. Columns drop by container width (1250 / 980 / 640px).
- Row hover/focus reveals Validate and Extract. Arrow keys move between rows; Enter in search opens the top row.
- A pipeline opens as a side sheet over the list; picks float in a bottom tray.

## Shape and depth
Radius 6 (badges, small buttons), 8 (controls, group bands), 10-12 (search, tray, palette). Shadows only on floating layers (tray, palette, dock); everything else is borders.

## Motion
150-250ms state transitions only. No entrance choreography, no looping decoration except real work in progress (running badge, spinners).
