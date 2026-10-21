# 통화 검색 Design System

## 0. Research Log

- Design read: personal on-device utility (PWA) for one Korean Android user, calm reading-first language, native CSS custom properties, system Korean font. Dials: variance 3, motion 3, density 5.
- Embedded refs: shortlisted `notion.md`, `claude.md`, `intercom.md` -> picked `taste-skill.md` (Layer A, operational read) + `notion.md` (Layer B) because warm reading-first minimalism with whisper borders fits long Korean transcripts; `intercom.md` was considered for the chat screen but one restrained system reads better than two.
- Lazyweb and StyleGallery: skipped. The surface is a standard Android list / detail / chat / settings shell; time went to the on-device pipeline the brief is judged on. Recorded as accepted debt below.
- Imagen drafts: skipped, no image-generation tool on this surface.
- Primitive showcase: primitives are exercised in the real screens with seeded states (empty, list, detail, sheet, progress, error) at 412 px and 1280 px in the E2E screenshots instead of a separate showcase page. Recorded as accepted debt.

## 1. Atmosphere & Identity

A quiet notebook of your calls. Warm paper-white surfaces, near-black ink, and one blue for the actions that matter; the transcript text is the hero and everything else steps back. The signature is the highlighter: every search hit is marked with a soft marker-yellow wash, the same mark in result snippets, in the full transcript and in the AI answer's quoted evidence, so finding a sentence feels like flipping to a page you underlined.

## 2. Color

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/page | --surface-page | #F7F6F3 | #191918 | App background |
| Surface/card | --surface-card | #FEFEFD | #222221 | List rows, panels, inputs |
| Surface/elevated | --surface-elevated | #FFFFFF | #2A2A29 | Sheets, dialogs, toasts |
| Surface/tint | --surface-tint | rgba(0,0,0,0.04) | rgba(255,255,255,0.06) | Secondary buttons, chips, pressed rows |
| Text/primary | --text-primary | #1F1E1C | #ECEBE9 | Body, titles |
| Text/secondary | --text-secondary | #615D59 | #A8A39D | Metadata, helper text |
| Text/tertiary | --text-tertiary | #77726C | #8E8984 | Placeholders, disabled |
| Border/default | --border-default | rgba(0,0,0,0.10) | rgba(255,255,255,0.10) | Whisper borders, dividers |
| Accent/primary | --accent | #0075DE | #0B6BCB | Filled primary buttons (white label 4.6:1 / 5.3:1) |
| Accent/pressed | --accent-pressed | #005BAB | #0A5DB0 | Pressed primary buttons |
| Accent/ink | --accent-ink | #0068C6 | #62AEF0 | Links, active tab glyph and label |
| Accent/wash | --accent-wash | rgba(0,117,222,0.08) | rgba(98,174,240,0.12) | Active tab, selected chip |
| Highlight | --mark-bg | #FCE7B2 | rgba(242,190,80,0.30) | Search hits (signature) |
| Highlight ink | --mark-ink | #3A2A05 | #FBEFD5 | Text inside marks |
| Status/success | --status-success | #0F7B2D | #4CC66A | Done states |
| Status/warning | --status-warning | #A84A00 | #F0A050 | Size notices, cautions |
| Status/error | --status-error | #C4321F | #FF7B6B | Failures, destructive |
| Focus | --focus-ring | #097FE8 | #62AEF0 | focus-visible outline |

### Rules
- Accent marks the one or two most likely actions on a screen, on the control's background. Nothing decorative carries accent.
- The highlighter (`--mark-bg`) only ever marks matched text.
- No colour outside this table.

## 3. Typography

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Title | 22px / 1.375rem | 700 | 1.27 | -0.01em | App bar titles |
| Heading | 18px / 1.125rem | 700 | 1.35 | -0.005em | Record contact name, section titles |
| Body/read | 17px / 1.0625rem | 400 | 1.75 | 0 | Transcript reading text |
| Body | 16px / 1rem | 400 | 1.55 | 0 | Default text, inputs |
| Body/medium | 16px / 1rem | 600 | 1.4 | 0 | Row titles, buttons |
| Body/sm | 14px / 0.875rem | 400 | 1.55 | 0 | Snippets, helper text |
| Caption | 13px / 0.8125rem | 500 | 1.4 | 0 | Dates, metadata |
| Badge | 12px / 0.75rem | 600 | 1.33 | 0.01em | Chips, badges |

### Font Stack
- Primary: `system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif` (the phone's own Korean UI font; no web font download, offline from the first paint).
- Mono: `ui-monospace, "SFMono-Regular", Menlo, monospace` for timestamps only.
- Numbers use `font-variant-numeric: tabular-nums`.

### Rules
- Body text never below 14px; captions and badges are metadata only.
- Korean text uses `word-break: keep-all` and `overflow-wrap: anywhere`.

## 4. Spacing & Layout

Base unit 4px.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Icon-to-label |
| --space-2 | 8px | Chip gaps, compact stacks |
| --space-3 | 12px | Row inner gaps, input padding |
| --space-4 | 16px | Page gutter, row padding |
| --space-5 | 20px | Section inner spacing |
| --space-6 | 24px | Sheet padding |
| --space-8 | 32px | Between groups |
| --space-10 | 40px | Empty-state breathing room |

### Grid
- Single column, max content width 720px centred (`--content-max`), 16px gutter on phones.
- App shell: `grid-template-rows: auto 1fr auto` on `100dvh`; the main region owns scrolling (`min-block-size: 0; overflow-y: auto`). Header and tab bar never scroll.
- Breakpoints: 640px (sheets become centred dialogs), 1024px (wider gutters).
- Touch targets at least 44 x 44px.

## 5. Components

### AppBar
- Structure: `header.appbar > [back IconButton] h1.title [actions]`.
- States: static. Back button only on detail screens.
- Layout: cluster; part of the shell header (not scrolling).

### TabBar
- Structure: `nav.tabbar > a.tab[aria-current] > svg + span` for 검색, 물어보기, 설정.
- States: default (secondary ink), active (`--accent-ink` glyph and label on `--accent-wash` pill behind the icon), pressed (tint), focus-visible ring.
- Accessibility: `aria-current="page"` on the active tab, labels always visible.

### SearchField
- Structure: `label.searchfield > svg + input[type=search] + button.clear`.
- States: default, focus (focus ring on the field), filled (clear button visible).
- Spacing: height 48px, padding 0 var(--space-3), radius --radius-md.

### FilterBar
- Structure: `div.filters > select.person + input[type=date] x2 + button.reset`.
- States: default, active filter (chip with `--accent-wash` and check glyph), reset visible only when a filter is set.
- Layout: horizontal cluster that wraps.

### RecordRow
- Structure: `a.row > div.row-head(strong.who + span.when) + p.snippet(mark...) + div.row-meta(badges)`.
- States: default (card surface + whisper border), pressed (`--surface-tint` wash, scale 0.99), focus-visible ring.
- Spacing: padding var(--space-4), gap var(--space-2), radius --radius-md.
- Content stress: long names ellipsize on one line, snippets clamp to 3 lines.

### Button / IconButton
- Variants: primary (accent fill, white label), secondary (`--surface-tint` fill, primary ink), ghost (transparent, accent ink), danger (error ink on tint).
- States: hover (darker fill or stronger tint), active (scale 0.98, 120ms), focus-visible ring, disabled (tertiary ink, no pointer), busy (label kept, inline spinner after 1s).
- Spacing: min-height 44px, padding 0 var(--space-4), radius --radius-sm; IconButton 44 x 44.

### Sheet (dialog)
- Structure: native `dialog.sheet > form > h2 + body + footer(buttons)`.
- Layout: bottom sheet under 640px (radius --radius-lg on top corners), centred dialog above.
- Motion: opacity + translateY(12px) in 200ms; reduced motion: opacity only.
- Accessibility: focus moves into the dialog, Escape closes, `aria-labelledby` the heading.

### Notice
- Structure: `div.notice > svg + div(strong + p)`.
- Variants: info (tint surface), caution (warning glyph and heading ink on tint surface). No coloured edge.

### ProgressRow
- Structure: `li.progress > div.progress-head(name + stage) + div.bar > div.fill`.
- States: queued, working (determinate fill via `transform: scaleX`), done (success glyph), error (error ink + retry/remove).

### Badge / Chip
- Badge: 12px label on `--surface-tint`, radius full. Chip: interactive badge with 32px height and 44px hit area.

### Toast
- Structure: `div.toast[role=status]` bottom-centred above the tab bar, 2.5s.

### ChatTurn (물어보기)
- Structure: question bubble (right, `--surface-tint`), answer block (left, plain reading text), sources row of Chips (contact + date) that open records.
- States: streaming (answer grows, caret), fallback (Notice + semantic result rows), error.

### EmptyState
- Structure: `div.empty > svg + h2 + p + actions`.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 120ms | ease-out | Button and row press |
| Standard | 200ms | cubic-bezier(0.2, 0, 0, 1) | Sheet open, toast in |
| Progress | continuous | linear | Determinate progress fill (transform) |

- Only `transform` and `opacity` animate.
- Async work: buttons disable at once; spinners only after ~1s; long work shows determinate progress.
- Reduced motion: translate and scale become opacity-only; progress fills stay.

## 7. Depth & Surface

Strategy: tonal shift plus whisper borders (Notion). Cards sit on the page by surface tone and a 1px `--border-default`; only sheets and toasts get the deep shadow.

| Level | Value | Usage |
|-------|-------|-------|
| Card | none + 1px solid var(--border-default) | Rows, panels |
| Deep | 0 1px 3px rgba(0,0,0,0.04), 0 7px 15px rgba(0,0,0,0.05), 0 23px 52px rgba(0,0,0,0.08) | Sheets, toasts |

| Token | Value | Usage |
|-------|-------|-------|
| --radius-sm | 8px | Buttons, inputs, chips |
| --radius-md | 12px | Rows, panels, search field |
| --radius-lg | 20px | Sheets |
| --radius-full | 9999px | Badges, tab pills |

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- WCAG 2.2 AA: 4.5:1 body text, 3:1 large text and UI glyphs; visible focus-visible ring on every control; full keyboard reachability; `lang="ko"`; `prefers-reduced-motion` and `prefers-color-scheme` respected.

### Accepted Debt
| Item | Location | Why accepted | Owner / Exit |
|------|----------|--------------|--------------|
| Lazyweb / StyleGallery research lanes not run | DESIGN.md section 0 | Standard Android utility grammar; time spent on the on-device pipeline | Revisit if 석 asks for a visual refresh |
| No separate primitive showcase page | E2E screenshots | Primitives verified inside the real screens with seeded states | Add a showcase if the component set grows |
| System font instead of a custom Korean web font | styles | Offline-first and light; the phone's UI font reads well | None planned |
