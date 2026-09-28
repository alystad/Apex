import type { GameMode } from "@/src/mode/gameModeTypes";

const jsonCache = new Map<string, { value: unknown; expiresAt: number }>();
const liveGameCache = new Map<string, { value: unknown; fetchedAt: number }>();

type CacheOptions = { ttlMs?: number };

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const hit = jsonCache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt < Date.now()) {
    jsonCache.delete(key);
    return null;
  }
  return hit.value as T;
}

export async function setCachedJson<T>(
  key: string,
  value: T,
  optionsOrTtl?: CacheOptions | number,
): Promise<void> {
  const ttlMs = typeof optionsOrTtl === "number" ? optionsOrTtl : optionsOrTtl?.ttlMs ?? 60_000;
  jsonCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function buildLiveGameCacheKey(gameId: string, mode?: GameMode): string {
  return mode ? `${mode}:${gameId}` : gameId;
}

export async function getCachedLiveGame<T>(
  gameId: string,
  mode?: GameMode,
): Promise<{ data: T; fetchedAt: number } | null> {
  const hit = liveGameCache.get(buildLiveGameCacheKey(gameId, mode));
  if (!hit) {
    return null;
  }
  return { data: hit.value as T, fetchedAt: hit.fetchedAt };
}

export async function setCachedLiveGame<T>(
  gameId: string,
  data: T,
  mode?: GameMode,
): Promise<void> {
  liveGameCache.set(buildLiveGameCacheKey(gameId, mode), {
    value: data,
    fetchedAt: Date.now(),
  });
}
