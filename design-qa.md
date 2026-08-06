# Reward Center Design QA

## Evidence

- Source visual truth: `/Users/ashley/.codex/generated_images/019fbc78-8b2c-7b71-a46b-e13185837f76/exec-2ef905f4-1d2f-4d35-ab34-1fcbf047a031.png`
- Implementation screenshot: `/private/tmp/reward-center-airy-runtime-final.png`
- Side-by-side comparison: `/private/tmp/reward-center-airy-comparison.png`
- Runtime: WeChat DevTools Nightly, iPhone 12/13 (Pro), light mode
- CSS viewport: `390 x 844`
- Device pixel ratio: `3`
- Source pixels: `853 x 1844`
- Implementation crop pixels: `670 x 1450`
- Comparison normalization: both artifacts resized to `426 x 922` before horizontal composition
- State: zero points, level 1, three available tasks, no pending voucher

## Full-view comparison

The implementation preserves the selected concept's hierarchy and visual flow: emerald points hero, one warm-white surface, a connected task rail, and three usage tiles. The two elements explicitly removed by the user—“从主页进入” and the “积分长期累积，需要时再用” footer card—are absent. Runtime density is intentionally more compact than the generated concept so the core earning and usage flow fits comfortably inside the real `390 x 844` mini-program viewport.

## Focused comparison

- Hero: emerald focal surface, level segments, paired point statistics, and botanical brand mark are present. The implementation uses the project's iconfont leaf mark rather than adding a one-off raster illustration.
- Tasks: all three rows keep the inline `+1积分`, consistent task icons, separators, connected accent rail, and `45px`-high completion controls.
- Usage: exercise, normal analysis, and precise analysis keep distinct icons, point costs, names, and exact entry paths in a balanced three-column layout.
- No extra focused crop was needed because the full-height normalized comparison keeps all important copy and controls readable.

## Required fidelity surfaces

- Fonts and typography: passed. Runtime content uses exactly `17px`, `14px`, and `11px` (`34rpx`, `28rpx`, `22rpx`) for user-facing text. Weight and wrapping remain legible; no title or reward amount is clipped.
- Spacing and layout rhythm: passed. The real viewport uses tighter vertical spacing than the concept while preserving section order, alignment, dividers, radii, and visual grouping.
- Colors and visual tokens: passed. Emerald, deep green text, mint surfaces, warm ivory, and restrained level gold match the selected direction with accessible contrast.
- Image quality and asset fidelity: passed. All visible icons use the project's existing iconfont system; the hero botanical mark is crisp at runtime and visually subordinate to the point data.
- Copy and content: passed. All task rewards and usage paths are correct. The two user-requested removals are verified absent.

## Findings

No actionable P0, P1, or P2 issues remain.

## Interaction and runtime checks

- Three task rows rendered.
- Three usage tiles rendered.
- First “去完成” control navigated to `packageExtra/pages/day-record/index` and returned successfully.
- Completion control measured `62 x 45px`, satisfying the 44px touch-height target.
- No runtime exceptions were captured during the interaction.
- The built-in automator screenshot endpoint returned `fail to capture screenshot` in this DevTools Nightly; visual evidence was therefore captured from the same WeChat DevTools simulator window after the automator had opened and inspected the page.

## Comparison history

1. Initial runtime check found the completion control at `37px` high (P2 touch-target mismatch).
2. Increased the control from `72rpx` to `88rpx`, rebuilt in watch mode, and rechecked it at `45px` high.
3. Post-fix comparison shows no remaining P0/P1/P2 findings.

## Follow-up polish

- P3: A future illustration pass could replace the project leaf glyph with a custom two-leaf sprout asset if the team wants exact concept-art fidelity; it is not required for usability or hierarchy.

## Final result

final result: passed
