export const IN_GAME_ROUTE_KEYS = [
  "preview",
  "comments",
  "playbyplay",
  "live",
  "team-stats",
  "betting",
] as const;

export type InGameRouteKey = (typeof IN_GAME_ROUTE_KEYS)[number];

export function isInGameRouteKey(value: unknown): value is InGameRouteKey {
  return typeof value === "string" && IN_GAME_ROUTE_KEYS.includes(value as InGameRouteKey);
}
