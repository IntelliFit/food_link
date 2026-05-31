# Food Link Website — Color Spec

Extracted from the WeChat mini program design system. Use these tokens for the marketing website to stay visually aligned with the app.

## Dual Green Note

The mini program uses two closely related greens:

| Hex | Role in mini program | Website token |
|-----|----------------------|---------------|
| `#00bc7d` | PRD brand primary, tabBar `selectedColor`, buttons in flows | **primary** |
| `#5cb896` | Home page `$primary-color`, custom tab bar FAB, stats | **secondary** |

The website spec treats `#00bc7d` as **primary** (official brand) and `#5cb896` as **secondary** (home ecosystem sage green).

## Light Theme

| Token | Hex / Value | Mini program source | Usage |
|-------|-------------|---------------------|-------|
| background | `#f0f3f6` | `src/app.scss`, `src/pages/index/index.scss` | Page floor |
| backgroundMuted | `#f9fafb` | `src/app.config.ts` `window.backgroundColor` | Window / tab bar |
| backgroundTint | `rgb(92 184 150 / 8%) → rgb(92 184 150 / 3%)` | `src/app.scss` page gradient | Top green mist |
| foreground | `#1f2937` | `$text-primary` in `index.scss` | Primary text |
| foregroundMuted | `#6b7280` | `$text-secondary` | Secondary text |
| foregroundSubtle | `#9ca3af` | `$text-tertiary` | Hints / placeholders |
| **primary** | `#00bc7d` | PRD, `tabBar.selectedColor` | Brand primary |
| primaryForeground | `#ffffff` | Button contrast | Text on primary |
| **secondary** | `#5cb896` | `$primary-color` | Home ecosystem green |
| secondaryForeground | `#ffffff` | UI contrast | Text on secondary |
| accent | `#8dd3bf` | `$primary-gradient-end` | Hover / gradient mate |
| accentAlt | `#5c9ed4` | `$blue-color` | Macro / feature accent |
| card | `#ffffff` | `$modal-sheet-bg` | Cards / panels |
| border | `#e5e7eb` | Common borders | Default border |

## Dark Theme (reserved)

| Token | Hex | Mini program source |
|-------|-----|---------------------|
| background | `#0f1312` | `fl-color-scheme-dark.scss` gradient end |
| foreground | `#e8ece9` | `$fl-dark-text` |
| foregroundMuted | `#9ca3a8` | `$fl-dark-text2` |
| primary | `#7dd3b0` | `$fl-dark-accent` |
| secondary | `#5cb896` | Brand coordination |
| card | `#1a2220` | `$fl-dark-surface` |
| border | `#3d5d51` | `$fl-dark-border` |

## Brand Gradients

| Name | Values | Source |
|------|--------|--------|
| Primary gradient | `#00bc7d → #00bba7` | `docs/note.md` |
| Page gradient | `rgb(92 184 150 / 8%) → #f0f3f6` | `src/app.scss` |

## shadcn/ui Mapping

Machine-readable tokens live in [`color-spec.ts`](./color-spec.ts). Use `toShadcnCssVars()` to map Food Link tokens to shadcn CSS variables (`--background`, `--primary`, etc.).

## Typography (reference)

Mini program default font stack from `src/app.scss`:

```
'Source Han Sans SC', 'SourceHanSansSC-Regular', 'PingFang SC',
'Hiragino Sans GB', 'Microsoft YaHei', sans-serif
```

The website uses the same stack via `--font-sans` in `theme-vars.css`.

## Implementation rules

- **No hardcoded colors in components** — use Tailwind semantic classes (`bg-primary`, `text-muted-foreground`, etc.) or CSS variables from `theme-vars.css`.
- **8px grid spacing** — use Tailwind spacing tokens `1`–`24` where each unit = 8px (defined in `index.css` `@theme`).
- **Screenshot placeholders** — replace `PhonePlaceholder` labels with real assets when ready.
