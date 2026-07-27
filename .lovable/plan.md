## Objective

Raise rendering quality of the existing Liquid Glass system to native iOS-26 realism. No layout, hierarchy, navigation or functionality changes — token, material and micro-interaction work only.

## 1. Material tokens (src/styles.css)

Rework the glass variables so every surface derives from one source of truth:
- `--glass-blur`: 40px → 32px (-20%); a lighter `--glass-blur-thin` (20px) for buttons/pills.
- `--glass-tint-strength`: 0.42 → ~0.30 light / 0.55 → ~0.42 dark, so the wallpaper stays visible.
- New tokens: `--glass-radius` (24px, unchanged), `--glass-edge`, `--glass-sheen-x/y` (pointer position), `--glass-elev-1/2/3` shadow sets.
- `use-wallpaper.tsx` keeps driving `--glass-tint`, but writes the new lighter strengths.

## 2. Optical depth + Fresnel

Rebuild `@utility glass-card` as layered, still using only background/box-shadow (no extra DOM where avoidable):
- base translucent gradient (top lighter → bottom denser),
- `::before` — Fresnel rim: conic/linear gradient border via `mask` so edges brighten toward top-left and bottom-right, no hard white outline,
- `::after` — glossy specular sheen driven by `--glass-sheen-x/y`, low opacity, `pointer-events:none`,
- inner shadows for internal reflection + edge diffusion, outer pair for ambient + contact shadow (floating cards).
Same treatment, thinner, for `glass-icon` and a new `glass-pill` / `glass-button` utility.

## 3. Dynamic reflections (performance-bounded)

Add `src/hooks/use-glass-pointer.ts`: one document-level `pointermove` listener, rAF-throttled, writing `--glass-sheen-x/y` on `documentElement` only. Cards read the shared variables plus their own position via CSS only — no per-card listeners, no React state, no re-renders. Disabled under `prefers-reduced-motion` and when the pointer is idle.

## 4. Buttons (high priority)

Extend `src/components/ui/button.tsx` with a `glass` variant (and `glassPrimary` for accent actions) built on the thin-glass utility: softer blur, brighter rim, adaptive tint, `active:scale-[0.97]` press depth, spring release via existing `springSnap`. Switch default/secondary/outline/ghost surfaces in app chrome to the glass variants, and apply the same material to segmented controls, pills, dropdown triggers, icon buttons and floating buttons. Radii unified to the 20–28px scale (`rounded-2xl`, `rounded-full` for icons).

## 5. Sidebar & nav

`AppSidebar.tsx`: lower tint strength, increase section separation with hairline dividers instead of heavier surfaces, hover = subtle tint lift + 1px rise, selected item = adaptive glow ring derived from `--glass-tint` + primary. Mobile tab bar gets the identical treatment so both read as one system.

## 6. Charts

`chart-style.ts` + chart routes: strokeWidth 2 → 1.5, `shapeRendering`/`vectorEffect` for crisper AA, smoother multi-stop area gradients, soft glow filter on the active line, tooltip rebuilt on the same glass tokens (32px blur, 20px radius, Fresnel rim) so it matches cards exactly.

## 7. Performance

- Animate only `opacity`/`transform`; keep `will-change` scoped to interactive tiles.
- Single rAF pointer loop; no per-component listeners.
- `React.memo` on `StatCard`, `TileSkeleton`, sidebar items; stable callbacks.
- Backdrop-filter applied on one element per surface (no nested blurs) and `contain: paint` on cards to cache backdrop layers.
- All blur/sheen effects short-circuit under `prefers-reduced-motion`.

## 8. Accessibility

Add a contrast guard: glass surfaces use `color-mix` against `--foreground` so text keeps ≥4.5:1 on any wallpaper; custom uploaded images get a slightly stronger scrim (already partly present) and the tint floor is clamped so panels never drop below a readable base.

## 9. Consistency pass

Sweep components for stray blur/radius/shadow/opacity values and replace them with the tokens, so every panel, dialog, sheet, popover, table and tooltip shares one material.

## Verification

Playwright screenshots of Dashboard, Settings, Sidebar and a chart route in light + dark on two wallpapers, plus a typecheck.
