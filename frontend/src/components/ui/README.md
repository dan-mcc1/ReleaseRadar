# Interface components

Shared building blocks for every page. Import from `components/ui`. If a page
needs something these don't do, extend the component rather than restyling it
locally, so every page gets the change.

## Tokens (`src/index.css`, `@theme`)

| Token | Utility | Use |
|---|---|---|
| Type scale | `text-caption` 12 · `text-label` 13 · `text-body` 14 · `text-title` 18 · `text-heading` 24 · `text-display` 36 | The only text sizes. No `text-[13px]`. |
| Radii | `rounded-control` 12 · `rounded-surface` 16 · `rounded-full` | Controls · cards, panels, posters · pills and round buttons |
| Control height | `h-control` 40 · `h-control-sm` 32 · `size-touch` 44 | Buttons, inputs, selects · dense rows · buttons over artwork |
| Accent | `primary-*` | The one main action and "on" states. Not decoration. |
| Numbers | `tabular` class, `<time>` | Counts, dates, ratings line up |

Focus rings, text selection, scrollbars and the caret are themed globally;
don't restyle them per component.

## Components

| Component | Use it for | Notes |
|---|---|---|
| `PageHeader` | Top of every page | Title, one line of context, page controls. No eyebrow labels. |
| `SectionHeader` | A group within a page | Title + quiet note + one action. `divider` when items follow. |
| `Button` / `ButtonLink` | Actions / actions that navigate | `primary` once per view; `secondary` default; `ghost` in toolbars; `danger`. |
| `IconButton` | Icon-only actions | `label` is required (tooltip + screen reader). `overlay` + `touch` on posters. `pressed` for toggles. |
| `Chip` | Filter toggles (genres, tags) | `dot` for a colour mark, `count` for matches. |
| `Segmented` | 2-4 exclusive options | View switches, type filters. |
| `SearchField` | Filtering a list | Clear button and Escape to clear built in. |
| `PosterCard` | A title in a grid | `actions` sit bottom-right in every state; `corner` top-left; `footer` for ratings. |
| `Card` | A panel that must read as one unit | Not a default wrapper. Never nest. |
| `EmptyState` | Nothing to show | Say what's empty and give the way out. |
| icons | `CheckIcon`, `PlusIcon`, … | Heroicons (24px outline, solid for "on"). No pasted `<svg>` paths or →★✓✕ glyphs. |

`selectClass` styles a native `<select>` like a secondary button; `cx` joins
class names.
