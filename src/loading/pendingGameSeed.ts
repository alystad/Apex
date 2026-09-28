import type { LiveGameListItem } from "@/src/features/basketball/api";

/**
 * Hands off the schedule list's already-known game data (team names, logos,
 * records, live score/status) to the destination game screen so it can paint
 * an instant, non-empty shell the moment it mounts — instead of starting
 * from nothing and waiting for the first network round trip.
 *
 * Same "stash a pending request, consume it on the other side" pattern as
 * src/ui/inGamePlayHighlight.ts, for the same reason: a plain event would
 * fire before the destination's LiveGameProvider is listening. Keyed by
 * gameId (not a single slot) since a user could conceivably back out and tap
 * a different game before the first one's effect has consumed its seed.
 */
const pendingSeedsByGameId = new Map<string, LiveGameListItem>();

export function stashPendingGameSeed(item: LiveGameListItem): void {
  pendingSeedsByGameId.set(item.gameId, item);
}

export function consumePendingGameSeed(gameId: string): LiveGameListItem | null {
  const item = pendingSeedsByGameId.get(gameId) ?? null;
  if (item) {
    pendingSeedsByGameId.delete(gameId);
  }
  return item;
}
