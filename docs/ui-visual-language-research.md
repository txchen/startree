# UI Visual Language Research: Huashu Design and Pintree New Tab

Research date: 2026-08-18  
Scope: typography, density, spacing, layout, color, borders, radii, and interaction patterns for a more compact StarTree UI.

## Executive recommendation

Use Pintree New Tab as the density and shell reference, and Huashu Design as the editorial filter. The resulting direction should be a compact bookmark workspace rather than a spacious marketing page:

- Use a restrained `12 / 14 / 16 / 19 / 23px` type scale. Most controls, navigation items, and card titles should be 14px; metadata should be 12px; reserve 19–23px for actual page headings.
- Build around a full-height, resizable sidebar and a roughly 56px utility bar. Let the bookmark grid consume the remaining canvas instead of centering it in a narrow presentation column.
- Use a 24px page/grid rhythm on desktop, reducing to 16px on smaller screens. Favor 4–6 bookmark columns on ordinary desktop widths.
- Keep one accent color. Use neutral surfaces and semantic color only where the content requires it.
- Reduce visual nesting: one surface, one boundary treatment. Avoid putting a bordered control inside a bordered card inside another elevated panel.
- Prefer 8px card radii, subtle hairlines, and near-flat surfaces. Reserve larger radii or pill shapes for controls whose shape communicates their behavior.
- Make interaction state changes immediate and quiet: surface tint, border/foreground change, or a small shadow. Avoid decorative motion and large lifts.

These are implementation recommendations derived from the sources below, not tokens published by either project.

## What Huashu Design contributes

Huashu Design is a design-production skill rather than a single branded UI system. Its useful contribution here is its explicit reasoning about density and common AI-generated design fingerprints.

### Typography

Huashu recommends a 1.2 modular scale for dashboards, documentation, and information-dense interfaces. It sets body text at 16–18px, small text at 14px, captions at 12–13px, and treats more than five hierarchy levels as uncontrolled ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/typography.md#L18-L39)). For StarTree, the 1.2 ratio can be translated into the compact `12 / 14 / 16 / 19 / 23px` working scale above.

Huashu also explicitly identifies Inter used as a display face as an AI-design fingerprint and recommends more characterful alternatives such as Newsreader or Schibsted Grotesk for display roles ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/typography.md#L104-L115)). The practical lesson is not to introduce a decorative font everywhere: use a distinctive face only for the few headings that need editorial character, while keeping high-legibility UI text neutral.

For prose, Huashu recommends 45–75 Latin characters per line, with 66 as the optimum, and 22–38 Chinese characters per line, with 28–32 as the optimum. It also gives tighter line-height ranges for headings than body copy ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/typography.md#L53-L85)). Those limits matter for descriptions and empty states, but they should not be used to constrain the entire bookmark canvas.

### Density and visual hierarchy

Huashu's default restrained pattern is unusually concrete: remove one container layer, one border, and one decorative icon. It advises adding density only when the additional information expresses the product's actual value ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/app-prototype.md#L107-L121)). Applied to StarTree, this means preserving useful bookmark metadata while stripping wrappers, badges, and ornamental labels that repeat the same hierarchy.

The skill sets a floor of 14px for body text, 12px for labels and captions, and 4.5:1 contrast for body copy. It also warns that whitespace must create composition rather than dead area ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/SKILL.md#L276-L285)). Compactness therefore should come from layout and hierarchy, not illegibly small text.

### Color and anti-patterns

Huashu recommends one warm base and one accent throughout an interface, avoiding multiple unrelated colors unless they encode real categories ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/app-prototype.md#L107-L121)). Its explicit anti-pattern list includes generic purple gradients, emoji icons, and the rounded card with a colored left border ([source](https://github.com/alchaincyf/huashu-design/blob/e735935ca0553a32de7ba4ba204fe3c79150b1b8/references/design-styles.md#L538-L543)). These are especially relevant to the request to remove the current "OpenAI-like" character.

## What Pintree New Tab contributes

Pintree New Tab is a directly comparable open-source browser-bookmark new-tab interface. Its README links the official [Chrome listing](https://chromewebstore.google.com/detail/ekfkalhnkifkoijcioheanlegfgcgnee), [Edge listing](https://microsoftedge.microsoft.com/addons/detail/pintreenewtab/mjiogedjmkbihhahaljlefekjbcgplog), and first-party screenshots ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/README.md#L15-L38)). The measurements below come from the source at commit `cf4f8915ebe81d49bc132999bdf1b8a2547ecd82`.

### Shell and layout

Pintree uses a full-height application shell with a desktop sidebar, a 64px logo row, and a sticky 56px toolbar ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/index.html#L53-L80)). Its sidebar is resizable and persisted, with a 256px default, 180px minimum, and 480px maximum ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/js/index.js#L310-L351)). This is a strong pattern for using wide displays without forcing either the tree or content area to be permanently oversized.

The search area starts 32px below the toolbar and is capped at 1024px while occupying 80% of the available width ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/index.html#L162-L209)). The bookmark content itself is not subject to this cap, so navigation and browsing stay dense even when search remains comfortably sized.

### Typography and component geometry

Pintree's working UI scale is compact: its desktop brand is 18px; tabs, breadcrumbs, sidebar items, and card titles are 14px; URLs and folder labels are 12px ([shell source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/index.html#L59-L67), [card source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/js/bookmarkRender.js#L33-L67)). This hierarchy lets many bookmarks remain scannable without making metadata compete with titles.

A link card uses 16px padding, an 8px radius, a subtle one-pixel ring and small shadow. It pairs a 32px favicon with a 16px gap, a 14px medium-weight title, and a 12px URL ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/js/bookmarkRender.js#L33-L67)). Its folder preview is 80px square with a 12px radius, 6px internal padding, 8px gaps, and 28px child icons ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/js/bookmarkRender.js#L146-L200)).

Pintree uses a 24px content padding and grid gap. Folder grids expand through 3, 6, 8, and 12 columns; link grids expand through 2, 3, 4, and 6 columns at responsive breakpoints ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/js/bookmarkRender.js#L243-L287)). The lesson is to spend width on additional scannable items rather than on larger cards.

### Color, borders, and interaction

Pintree's palette is neutral with a single green family: `#0BA665` for the brand, `#3CB884` for folders, and darker brand-button hover and active states. Its dark surfaces step from `#111418` to `#22252A`, `#272A30`, and `#2D3139` ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/css/styles.css#L6-L30), [dark surfaces](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/css/styles.css#L180-L225)). This gives hierarchy through subtle surface steps instead of gradients or glow.

Link cards respond with a surface tint and small shadow. Folder tiles lift 5px over 200ms while their paper layers animate over 300ms ([source](https://github.com/tangxiaoqi-tangxiao/PintreeNewTab/blob/cf4f8915ebe81d49bc132999bdf1b8a2547ecd82/src/entrypoints/page/css/styles.css#L68-L149)). StarTree should borrow the immediate hover affordance but reduce the folder lift to 1–2px, or omit movement, to keep the interface calmer and avoid making the grid feel toy-like.

## Proposed StarTree design tokens

The following is a synthesis for implementation, not a transcription of either source.

| Area                             | Proposed value                                                    |
| -------------------------------- | ----------------------------------------------------------------- |
| Type scale                       | `12, 14, 16, 19, 23px`                                            |
| Metadata / secondary labels      | `12px / 1.35`                                                     |
| Navigation, controls, card title | `14px / 1.4`                                                      |
| Body / input text                | `16px / 1.5`                                                      |
| Section / page headings          | `19px` and `23px`, respectively                                   |
| Utility bar                      | `56px` high                                                       |
| Sidebar                          | `240px` default; user-resizable from roughly `180–420px`          |
| Desktop canvas padding           | `24px`; `16px` below tablet width                                 |
| Grid gap                         | `16–20px` for links; `20–24px` for folders                        |
| Bookmark icon                    | `28–32px`                                                         |
| Card padding                     | `12–16px`                                                         |
| Small / control / card radius    | `4px / 6px / 8px`                                                 |
| Border                           | one neutral 1px hairline, or a subtle shadow, not both by default |
| Accent                           | one restrained brand hue plus semantic error/warning colors       |
| Hover                            | foreground/border/surface change in `120–180ms`                   |
| Selected state                   | tinted surface plus stronger text; no glow                        |

## Recommended implementation order

1. Replace any landing-page-sized heading scale with the five-level compact scale.
2. Rebalance the shell so the sidebar and utility bar occupy fixed working dimensions while the grid absorbs remaining width.
3. Increase columns before increasing card size; cap only prose and search, not the bookmark canvas.
4. Remove one nesting layer from the search area, cards, and empty states wherever the same boundary is drawn twice.
5. Normalize radii and boundary treatments, then reduce color to neutrals plus one accent.
6. Add consistent hover, selected, focus-visible, and pressed states and verify them at ordinary laptop and wide-desktop sizes.

## Source quality and limitations

All product measurements are from first-party repositories at fixed commits. Pintree's public screenshot is older than some current source changes, so source values take precedence over screenshot measurements. Huashu's guidance is opinionated design methodology, not usability research; its rules are used here as a critique framework and cross-checked against Pintree's working implementation. Accessibility contrast and target-size decisions should still be validated in StarTree itself.
