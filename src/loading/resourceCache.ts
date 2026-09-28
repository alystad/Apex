type ResourceCacheEntry<T> = {
  data: T;
  updatedAt: number;
};

const resourceCache = new Map<string, ResourceCacheEntry<unknown>>();

export function readResourceCache<T>(
  cacheKey: string,
  staleTimeMs: number,
): T | null {
  const entry = resourceCache.get(cacheKey) as ResourceCacheEntry<T> | undefined;
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > staleTimeMs) {
    return null;
  }

  return entry.data;
}

export function writeResourceCache<T>(cacheKey: string, data: T): void {
  resourceCache.set(cacheKey, {
    data,
    updatedAt: Date.now(),
  });
}

export function clearResourceCache(cacheKey?: string): void {
  if (!cacheKey) {
    resourceCache.clear();
    return;
  }
  resourceCache.delete(cacheKey);
}
