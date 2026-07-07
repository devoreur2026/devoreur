# Devoreur — Brand Assets ("The Eater")

The mark is **the Eater**: a hooded dark creature with two glowing ember eyes,
a tattered cloak hem, on a near-black background. This replaces the old UMBRA
branding everywhere.

## Palette
- Background / void: `#08080d`
- Disc / dark surface: `#0d0b16`
- Cloak (outer): `#15121f`  ·  Cloak (inner): `#221d33`
- Hood cavity: `#0b0912`
- Ember eye (outer): `#ff4d1a`  ·  Ember eye (core): `#ffe08a`
- Wordmark cream: `#f2ead6`  ·  Gold accent: `#e8b04a` / `#c98f2e`
- Faint mystic dust: `#8a6bff`
- Wordmark font: serif (Georgia / Times), wide letter-spacing, sentence tagline

## Files

| File | Size | Use |
|------|------|-----|
| `favicon-32.svg` | 32×32 | Browser tab favicon at the smallest size — minimal (hood + solid eyes). |
| `favicon.svg` | 64×64 | Favicon / app icon at small-to-medium sizes (hood + eyes, rounded square). |
| `eater-icon.svg` | 512×512 | Master icon — full detail. App icon, large touch icon, anywhere with room. |
| `logo-horizontal.svg` | 520×120 | Header / nav bar — Eater icon + DEVOREUR wordmark side by side. |
| `title-lockup.svg` | 680×560 | Game start screen — Eater above the DEVOREUR wordmark + taglines. **Use this to replace the current UMBRA title.** |
| `social-og.svg` | 1200×630 | Open Graph / social share image for link previews. |

## Wiring instructions (for Claude Code)

1. **Favicon:** put `favicon.svg` in the project and reference it in `index.html`:
   `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
   Replace the current inline gold-ring favicon. (Optionally add `favicon-32.svg`
   for the smallest fallback.)

2. **Start screen:** replace the existing UMBRA title element with
   `title-lockup.svg` (inline the SVG or reference it). Remove the old "UMBRA"
   text and any "the maze that eats light" text that the lockup already contains,
   so it isn't duplicated.

3. **Header / in-game wallet screen:** use `logo-horizontal.svg` wherever a
   compact logo fits.

4. **Social preview:** if the OG image needs to be a raster (PNG) — some platforms
   don't accept SVG for `og:image` — convert `social-og.svg` to a 1200×630 PNG and
   reference it, then set the meta tags:
   ```html
   <meta property="og:title" content="Devoreur — the maze that eats light">
   <meta property="og:description" content="Hunt the treasure. Evade the Eaters. Burn your rivals. Real stakes.">
   <meta property="og:image" content="https://devoreur.com/og-image.png">
   <meta property="og:url" content="https://devoreur.com">
   <meta name="twitter:card" content="summary_large_image">
   ```

5. **Rename UMBRA → Devoreur everywhere** — page `<title>`, headings, comments,
   and any remaining references. UMBRA is retired.

## Note on PNG conversions
These are SVG (scalable, sharp at every size). For places that require raster
(app-store icons, some social platforms, favicon.ico fallback), export the SVG
to PNG at the needed resolution — Claude Code can do this with a library like
`sharp` (Node) or `rsvg-convert` / `cairosvg`.
