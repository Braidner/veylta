# Veylta Design System

## Intent

Physical scene: a parent at a kitchen table reviews a new laboratory report before a clinician visit and needs calm, legible evidence rather than reassurance theater.

The interface is a restrained, light product surface inside a softly atmospheric home workspace. Pure white keeps uploaded documents visually truthful. An azure-to-indigo-to-violet gradient marks the selected assistant and primary action; semantic color still communicates state or provenance rather than decoration.

## Color

All implementation tokens use OKLCH.

```css
:root {
  --color-bg: oklch(0.952 0.008 255);
  --color-canvas: oklch(0.985 0.003 255);
  --color-surface: oklch(0.97 0.006 255);
  --color-ink: oklch(0.19 0.02 255);
  --color-muted: oklch(0.48 0.022 255);
  --color-line: oklch(0.89 0.012 255);
  --color-primary-start: #1473f3;
  --color-primary: #3e42e8;
  --color-primary-end: #7457ee;
  --color-accent: oklch(0.63 0.14 165);
  --color-success: oklch(0.56 0.13 160);
  --color-warning: oklch(0.65 0.16 70);
  --color-danger: oklch(0.56 0.18 27);
}
```

The gradient is reserved for the selected assistant and primary action. A single primary color handles focus, links, and selected navigation. Accent identifies evidence/source affordances. Semantic colors are paired with an icon and text label. Pale state backgrounds are derived from the semantic hue at high lightness rather than by lowering text contrast.

## Typography

Use the self-hosted Geist variable font package with the native system sans stack as fallback. Its exact OFL-1.1 distribution is reviewed in the license policy and does not make a network request. Body copy is 16px with a 1.5 line height; compact metadata is never smaller than 12px inside bounded dashboard cards and 13px in reading surfaces. Product headings use a fixed modular scale and balanced wrapping. Prose is capped at 70ch; data tables may be wider.

## Layout

- Desktop uses a persistent top workspace bar and a full-viewport application canvas. There is no decorative preview frame, outer margin, maximum width, corner radius, or drop shadow around the authenticated profile surface; 40px of internal padding remains as the working safe area.
- The first desktop viewport follows one named dashboard grid: the three stacked assistants occupy the left column, a narrow rail exposes real overview shortcuts, four factual signals run across the upper right, and the latest document plus care-plan preview share the lower right. Administrative profile controls begin below that overview.
- The active profile is repeated beside context-sensitive page titles, not hidden only inside navigation.
- Review uses one contiguous work surface: source facts on the left and the decision controls alongside them. Avoid nested cards.
- Mobile collapses columns into source-first reading order and exposes the four real profile anchors in a safe-area-aware bottom navigation.
- Spacing follows a 4px base with deliberate 8, 12, 16, 24, 32, and 48px steps.

## Components

- Controls use a 10px radius; panels top out at 14px. Pills are reserved for compact statuses.
- Buttons and inputs expose default, hover, focus-visible, active, disabled, loading, and error states.
- Loading is represented by local skeletons or explicit processing steps, not a page-level spinner.
- Empty states explain the first safe action and the accepted synthetic document types.
- Review status uses explicit labels: `Extracted`, `Needs review`, `Confirmed`, and `Rejected`.
- Provenance is rendered as a normal source link with document name, page, and a short quoted fragment; technical identifiers remain secondary.
- Assistant cards look conversational but every action opens an implemented source, review, history, or care-plan surface. They never impersonate a professional.
- Health signals use explicit labels and numbers. They never compress evidence into a score, rating, ring, or unexplained color.

## Motion

Transitions last 160–220ms with ease-out curves and only communicate state: upload progress, row confirmation, inline disclosure, and navigation selection. Content is visible before animation. Under `prefers-reduced-motion: reduce`, transitions become immediate.

## Content

Write in plain, specific language. Avoid diagnosing, prescribing, or implying that extracted data is confirmed. A warning states the required action and consequence; it does not use legalistic filler. Dates and units appear beside values, never only in a tooltip.
