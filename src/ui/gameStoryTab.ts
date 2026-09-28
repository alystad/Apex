/**
 * The game's "story" tab is a single persistent tab in the first position
 * whose label AND content both follow the game's status. Both sides read the
 * helpers here — the screen (app/(tabs)/preview.tsx) to pick which view to
 * render, the tab bar (app/(tabs)/_layout.tsx) to pick the label — so the
 * label can never disagree with what the tab is actually showing.
 *
 * It occupies the historical `preview` route key. That predates the merge and
 * is kept deliberately: changing the route key would break deep links and
 * saved tab-layout preferences for no user-visible gain. Note this is NOT the
 * `live` route key, which is the Court tab.
 */
export type GameStoryPhase = "preview" | "live" | "recap";

const GAME_STORY_TAB_LABELS: Record<GameStoryPhase, string> = {
  preview: "Preview",
  live: "Live",
  recap: "Recap",
};

// Feeds are not consistent about these strings — different sources report a
// finished game as "post", "final" or "complete", and an in-progress one as
// "in" or "live". The rest of the app already accounts for that (see
// components/ui/StickyScoreHeader.tsx and app/match/[id].tsx for the finished
// set, src/features/nba/api.ts for the live set); matching those sets here
// keeps the story tab from showing a Preview for a game that has actually
// tipped off or ended.
const FINISHED_STATES = new Set(["post", "final", "complete"]);
const IN_PROGRESS_STATES = new Set(["in", "live"]);

/**
 * Maps a raw `status.state` from the live-game feed onto the story tab's
 * phase. Unknown/missing states fall back to "preview", which is the safe
 * default: it's the only phase that doesn't assert a game has started.
 */
export function getGameStoryPhase(state: string | undefined | null): GameStoryPhase {
  const normalized = (state ?? "").trim().toLowerCase();
  if (FINISHED_STATES.has(normalized)) {
    return "recap";
  }
  if (IN_PROGRESS_STATES.has(normalized)) {
    return "live";
  }
  return "preview";
}

export function getGameStoryTabLabel(state: string | undefined | null): string {
  return GAME_STORY_TAB_LABELS[getGameStoryPhase(state)];
}
