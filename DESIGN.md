# Veylta Design System

## Intent

Physical scene: a parent at a kitchen table reviews a new laboratory report before a clinician visit and needs calm, legible evidence rather than reassurance theater.

The interface is a restrained, light product surface. Pure white keeps uploaded documents visually truthful; a measured cobalt anchors actions and navigation. Color communicates state or provenance and is never decorative.

## Color

All implementation tokens use OKLCH.

```css
:root {
  --color-bg: oklch(1 0 0);
  --color-surface: oklch(0.972 0.004 250);
  --color-surface-strong: oklch(0.94 0.009 250);
  --color-ink: oklch(0.20 0.025 250);
  --color-muted: oklch(0.45 0.025 250);
  --color-line: oklch(0.88 0.012 250);
  --color-primary: oklch(0.40 0.11 250);
  --color-primary-hover: oklch(0.34 0.11 250);
  --color-accent: oklch(0.67 0.14 170);
  --color-success: oklch(0.45 0.11 155);
  --color-warning: oklch(0.63 0.14 75);
  --color-danger: oklch(0.51 0.18 25);
}
```

Primary color is reserved for the current selection, focus, links, and primary action. Accent identifies evidence/source affordances. Semantic colors are paired with an icon and text label. Pale state backgrounds are derived from the semantic hue at high lightness rather than by lowering text contrast.

## Typography

Use the native system sans stack to avoid an external font dependency and keep controls familiar across platforms. Body copy is 16px with a 1.5 line height; compact metadata is never smaller than 13px. Product headings use a fixed modular scale, balanced wrapping, and letter spacing no tighter than -0.025em. Prose is capped at 70ch; data tables may be wider.

## Layout

- Desktop uses a persistent top workspace bar and a centered content column up to 1200px.
- The active profile is repeated beside context-sensitive page titles, not hidden only inside navigation.
- Review uses one contiguous work surface: source facts on the left and the decision controls alongside them. Avoid nested cards.
- Mobile collapses columns into source-first reading order and keeps the primary review action within thumb reach without obscuring content.
- Spacing follows a 4px base with deliberate 8, 12, 16, 24, 32, and 48px steps.

## Components

- Controls use a 10px radius; panels top out at 14px. Pills are reserved for compact statuses.
- Buttons and inputs expose default, hover, focus-visible, active, disabled, loading, and error states.
- Loading is represented by local skeletons or explicit processing steps, not a page-level spinner.
- Empty states explain the first safe action and the accepted synthetic document types.
- Review status uses explicit labels: `Extracted`, `Needs review`, `Confirmed`, and `Rejected`.
- Provenance is rendered as a normal source link with document name, page, and a short quoted fragment; technical identifiers remain secondary.

## Motion

Transitions last 160–220ms with ease-out curves and only communicate state: upload progress, row confirmation, inline disclosure, and navigation selection. Content is visible before animation. Under `prefers-reduced-motion: reduce`, transitions become immediate.

## Content

Write in plain, specific language. Avoid diagnosing, prescribing, or implying that extracted data is confirmed. A warning states the required action and consequence; it does not use legalistic filler. Dates and units appear beside values, never only in a tooltip.
