Original prompt: I want to remove all the liquid glass components in the app I want the header in game to be just black. And all the ui should go back to how it was. It should all just be black and no changing of colors or liquid glass.

- Replaced liquid-glass surfaces with static black surfaces and neutral borders.
- Removed blur/lens/orb layers from StickyScoreHeader and set header background to black.
- Updated shared glass/chip color tokens to black in src/theme/colors.ts and apps/mobile/src/design/tokens.ts.
- Simplified apps/mobile GlassButton and SegmentedPill to non-blurred black styling.

- Validation: ran `npx tsc --noEmit`; it fails due to pre-existing `apps/api` import/type errors unrelated to these UI edits.
- TODO: if needed, replace remaining themed accent text colors in non-liquid components for a fully monochrome UI across every screen.

- Removed tab/slider bubble fills in shared TabBar and SegmentedControl: tabs are now text-only with active white label and muted inactive label.
- Updated mobile SegmentedPill and DateScrollWheel to the same active-white / inactive-muted text-only behavior.
- Updated live-games top-edge mini filter chips to remove active bubble backgrounds.
- Validation:
px tsc --noEmit still fails only due to pre-existing apps/api type/import errors.

- Removed outer slider/tab container bubbles by replacing TabBar and SegmentedControl dock wrappers with plain Views.
- Cleared SegmentedPill wrapper border/background so no surrounding bubble remains.
- Validation:
px tsc --noEmit unchanged; only pre-existing apps/api errors.

- Added fillColor and hideBorder to LiquidGlassSurface so cards can be dark gray with no outline.
- Updated both shared Card wrappers to render with theme.colors.card fill and hideBorder enabled.
- Updated theme palette: app background is black and card/surface tones are dark gray (#666B70) across dark/light modes.
- Sticky in-game header remains black.
- Validation:
px tsc --noEmit unchanged with pre-existing apps/api errors.

- Refined design system to requested palette: bg #000000, card #121212, elevated #1A1A1A, border rgba(255,255,255,0.05), text #F5F5F5/#A3A3A3/#6B7280, accents #3B82F6/#F97316.
- Added shared CardContainer style in src/theme/cardStyles.ts and reused it in both shared Card wrappers.
- Card wrappers now enforce consistent 12 radius, subtle border, 14 padding, and subtle depth while keeping component structure/logic unchanged.
- Verified StickyScoreHeader remains black.
- Validation:
px tsc --noEmit still fails only due to pre-existing apps/api errors.

- Reduced global horizontal gutters so cards/court sit closer to left/right edges: AppScreen (16->8), GameTabScreenScaffold (16->8), StickyScoreHeader (16->8).
- Reduced major standalone screen gutters: live-games header/content/scene/date slider/modal list (12->8), team content (12->8), player content + sticky tab strip (12->8), match main content (14->8), playbyplay chrome/list (12->8), multiview screen padding (12->8).
- Tightened comments panel gutters for consistency (16->10 and 12->8 where appropriate).
- Validation:
px tsc --noEmit unchanged; only pre-existing apps/api errors.

- Removed card outlines globally via shared card primitives: CardContainer borderWidth set to 0 and shared Card wrappers now pass hideBorder.
- Removed court background rendering in CourtOverlay by removing hardwood/spotlight/vignette fill layers and setting court container background to transparent.
- Validation:
px tsc --noEmit unchanged; only pre-existing apps/api errors.

- Updated the shared in-game player modal sheet background in components/PlayerModal.tsx from `theme.colors.bg` to `theme.colors.card` so it matches in-game card surfaces.
- Validation pending: run `npx tsc --noEmit` to confirm no new type issues beyond the existing `apps/api` failures.

- Removed team-driven accent colors from the shared player modal by swapping hero glows, team chip fill/border, headshot ring, and impact badge styling to neutral theme surface/border tokens in `components/PlayerModal.tsx`.
- Validation pending: re-run `npx tsc --noEmit`; expect only the existing unrelated type failures unless another pre-existing issue surfaces.

- Lowered the player modal by reserving space for a compact team roster strip at the top of the screen in `components/PlayerModal.tsx`.
- Added a thin horizontal roster header above the player modal that lists the selected player's full team, allows switching players inline, and fades/slides out with the modal dismissal gesture.

- Replaced the text roster strip in `components/PlayerModal.tsx` with a swipeable paged bubble header built from `PlayerBubble`, sorted from highest in-game rating to lowest.
- The top roster now reuses the team ring/headshot/rating bubble treatment from the court overlay and highlights the currently selected player while keeping the dismiss-linked fade/slide behavior.

- Replaced the paged roster header in `components/PlayerModal.tsx` with a plain horizontal slider so the player modal remains the only major surface using the app's heavier swipe animation.
- Tightened the top-roster bubble spacing by moving to fixed-width slider slots so the players sit closer together while keeping the same `PlayerBubble` visual treatment.

- Removed the `x` close button from the player modal hero header in `components/PlayerModal.tsx`; dismissal remains through backdrop tap and swipe-down.

- Converted the player modal body in `components/PlayerModal.tsx` to a `TabView` pager so swiping inside the modal content switches between players using the same horizontal swipe behavior as the rest of the app.
- Kept the top roster as a plain slider; it now only reflects and changes player selection while the swipeable modal body owns player-to-player navigation.

- Added measured centering logic to the top player-modal roster slider in `components/PlayerModal.tsx`, matching the in-game tab-slider behavior: the active player scrolls to center when possible and clamps naturally at the far left/right edges.

- Updated the match view in `app/live-games.tsx` to render conference-scene games in a two-column grid.
- Match cards now show conference-only metadata plus a `Home` marker on the home team row while preserving status, teams, scores, and baseball live-state details.

- Added a team favorite star to the team profile header in `app/team/[teamId].tsx`, wired to the existing persisted `favoriteTeamId` profile state.
- Team favoriting is single-select: starring a team replaces the previous favorite, and tapping the current favorite again clears it.

- Added a new `team` theme mode in settings and extended the saved favorite-team profile data to persist primary/secondary colors.
- `useAppTheme` now builds a dynamic palette from the favorited team's colors: card backgrounds use the team's primary color and app backgrounds use the team's secondary color, with fallback to the normal theme when no favorite team palette is available.

- Expanded the saved favorite-team payload to include team display info and logo so the app can surface the favorited team in the profile screen's existing `Favorite Team` slot.
- The profile screen now shows the pinned team's name/logo instead of placeholder copy, and that row stays visible under the `Team Colors` theme because it already uses the live theme hook.

- Replaced the old layered icon crown in `components/PlayerBubble.tsx` and `components/ui/PlayerRow.tsx` with a shared illustrated gold crown component in `components/ui/TopPerformerCrown.tsx` to better match the supplied crown image.

- Replaced the generated crown art in `components/ui/TopPerformerCrown.tsx` with the user-provided asset at `assets/images/top-performer-crown.png` so the in-game crown now uses the exact supplied image.
- Updated `components/ui/TopPerformerCrown.tsx` to preserve the PNG's transparent background and render the crown at 1.5x its previous size everywhere the shared in-game crown component is used.
- Adjusted `components/ui/TopPerformerCrown.tsx` so the crown is rotated `-25deg` and shifted slightly up-left to better match the desired in-game placement.
- Updated the shared in-game header spacing so every `GameTabScreenScaffold` tab keeps its first content block locked to the tab slider during header collapse by replacing the fixed top padding with an animated spacer driven from the sticky-header collapse math.
- Fixed a runtime hazard in the new in-game header spacer by making the shared content-offset helper in `components/ui/StickyScoreHeader.tsx` worklet-safe for Reanimated, which should stop the game screen from crashing on open.
- Corrected the in-game spacer math so the first content block stays visually below the tab slider throughout the collapse range instead of rising above it early while the header is still collapsing.
- Reworked the shared in-game content lock to use a single animated content transform in `components/GameTabScreenScaffold.tsx` instead of a changing spacer height, so the tab slider and court/top content move together more smoothly during header collapse.
- Updated `components/ui/StickyScoreHeader.tsx` so the header blur/tint background translates with the same collapse motion as the tab slider, making the header background, slider, and top of the court feel like one connected moving surface.
- Swapped the shared in-game scroll view from an object ref to a callback ref in `components/GameTabScreenScaffold.tsx` to avoid React writing to a frozen `ref.current` object during mount, which addresses the immutable `current` runtime error.
- Removed the shared in-game `useAnimatedReaction` tab-sync path from `components/GameTabScreenScaffold.tsx` so no JS ref-bearing callback is captured by a Reanimated worklet when opening games, which targets the remaining immutable `current` crash.
- Replaced the in-game content-lock `useAnimatedStyle` in `components/GameTabScreenScaffold.tsx` with plain JS scroll state and a regular transform style, eliminating the exact Reanimated `useAnimatedStyle` mount path reported by the immutable `current` error stack.
- Fixed an invalid Reanimated attachment in `components/ui/StickyScoreHeader.tsx` by moving the animated background translation off the plain `BlurView` and onto an `Animated.View` wrapper, which is a likely source of the immutable `current` mount error.
- Added a shared match-card origin registry and an interactive in-game pull-down exit flow: `app/live-games.tsx` now captures live-game card frames for main match-list launches, `app/(tabs)/_layout.tsx` wraps the in-game experience in a single animated card container, and `components/GameTabScreenScaffold.tsx` now drives a threshold-based pull-down-to-dismiss gesture when a tab is scrolled to the top.
- Narrowed the player modal drag-to-dismiss gesture to the grabber only in `components/PlayerModal.tsx` so dragging on text, stat cards, and other modal content scrolls reliably instead of being intercepted by the sheet pan gesture.
- Restored player-modal pull-down dismissal through the scroll view's top overscroll in `components/PlayerModal.tsx`, so you can still drag past the top to close the modal without losing normal scrolling when starting a drag on text or other content.
- Updated the player modal sheet pan in `components/PlayerModal.tsx` to use manual activation, so the original pull-down-to-dismiss logic stays intact but the gesture does not activate until the drag is clearly a downward pull from the top, allowing scrolling to start reliably from text and other modal content.
- Switched the player modal back to dismissing from the scroll view's own top overscroll in `components/PlayerModal.tsx`, while keeping the separate sheet pan only on the grabber, so dragging can start anywhere in the modal content and only begins pulling the modal out once the scroll view is already fully at the top.
- Added real wall-clock timestamps to live-game win probability points in `hooks/useLiveGame.tsx` and updated `components/MomentumTopStatsCard.tsx` to show a clamped hover time label above the active guide line while dragging across the momentum chart.
- Added a fallback real-clock estimate from `startDateTime` for `components/MomentumTopStatsCard.tsx`, and passed game start times from both `app/(tabs)/live.tsx` and `app/match/[id].tsx`, so the momentum hover time stays visible while dragging even when the feed omits per-play timestamps.
- Removed the pressed-state marker dots from `components/MomentumTopStatsCard.tsx` so dragging on the momentum graph only shows the guide line, hover time, and percentage pills.
- Added a fixed right-side chart gutter in `components/MomentumTopStatsCard.tsx` so the momentum lines sit farther left and no longer run underneath the fixed win-percentage pills.
- Added a full per-tab in-game Edit Screen flow: the shared header 3-dot menu now opens a new `in-game-edit` route, section order/hidden state persists in `src/settings`, and the in-game tabs now resolve their top-level sections through a shared section-layout model so each tab can be reordered and hidden independently.
- Expanded the in-game Edit Screen into one combined editor: the top list now globally reorders and hides the in-game tab slider (`Odds`, `Comments`, `Court`, etc.) through a new persisted `tabLayout`, while the lower list still edits only the launching tab’s sections with one shared `Cancel` / `Save` flow and reset-to-default behavior.

- Added a new WNBA-only "Stock Market" section (virtual/practice currency only — no real money anywhere): new `Stock Market` item in the live-games hamburger menu opening `app/stock-market/`, with a market watchlist, player detail + price chart + buy/sell, portfolio, transaction history, and a leaderboard.
- Pricing reuses the app's existing Impact Rating as the single source of truth — `src/features/stockmarket/pricing.ts` only rescales it ($10 per rating point, so a 9.0 trades at $90). Live prices read `inGameRating10` off the same `buildLiveGameDataFromPayload` output the in-game screens use; season/trend prices come from a new `getPlayerSeasonRatingSeries` in `src/features/basketball/playerApi.ts`, which is a thin projection of the existing `normalizeGameLog` -> `computeImpactFromBox` pipeline (no parallel rating model).
- Single-game positions follow the live rating at the app's normal 5s cadence and auto-close at the final buzzer (including games that ended while the app was closed); season positions follow the rolling season average and never force-close.
- Reused existing visual language: player photo + rating-badge treatment from the in-game leaderboard row, and the shared `PlayerRatingGraph` detailed chart for the price line (added an optional `valueLabelFormatter` prop so the identical chart can be relabeled with "$" ticks).
- Leaderboard note: the app has no user accounts or shared backend, so it ranks the real local portfolio against a fixed field of deterministic SIMULATED practice traders, labeled as such in the UI (`src/features/stockmarket/leaderboard.ts` is the single swap point if a real ranking service is added).
- Validation: `npx tsc --noEmit` reports no errors in any new/changed file (only the pre-existing `apps/api` and `components/CourtOverlay.tsx` failures remain), and `npx expo export --platform ios` bundles successfully.

- Restyled the entire Stock Market section into its own Robinhood/Coinbase-style visual language, deliberately separate from the rest of the app: pure-black screens with no cards (hairline separators only), 52pt hero prices / 44pt portfolio value, one green (#00C805) and one red (#FF453A) used consistently for every gain/loss, and tabular figures on every numeric value.
- Added `src/features/stockmarket/marketTheme.ts` as the section's own token module. It is intentionally flat constants rather than `useAppTheme()` — the app's light/dark/team-color palettes must not repaint a section whose whole point is that green means up and red means down.
- New `components/stockmarket/MarketChart.tsx`: smooth monotone curve (reusing the shared `buildMonotoneLinePath`), gradient area fill fading to transparent, a single dashed open-price gridline, no container border. Doubles as the list-row sparkline via `variant="spark"`.
- Added the 1D/1W/1M/Season/All range control (`components/stockmarket/TimeRangeSelector.tsx` + `src/features/stockmarket/priceHistory.ts`); the range drives both the chart and the change figure/caption under the price. 1D reads the intraday live rating path; 1W/1M filter season games by date; All appends the current live mark to the season line.
- Player detail now has a fixed bottom trade bar (full-width green `Buy` pill, outlined `Sell` pill shown only when a position exists) opening a `TradeSheet` order ticket instead of the old inline panel.
- Removed the superseded `StockPlayerRow`, `StockPriceChart`, and `TradePanel` components, and reverted the `valueLabelFormatter` prop previously added to the shared `components/ui/PlayerRatingGraph.tsx` (no longer used).
- Validation: `npx tsc --noEmit` clean for every new/changed file (only the pre-existing `apps/api` and `components/CourtOverlay.tsx` failures remain); `npx expo export --platform ios` bundles successfully; grepped the section for `useAppTheme`/`Card`/`LiquidGlass`/`getInGameRatingColor`/`FireRing` to confirm no app-aesthetic components leak in.
