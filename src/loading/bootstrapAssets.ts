import { Image } from "react-native";

import type { LiveGameData, LiveGamePlayer } from "@/hooks/useLiveGame";

export const TRANSPARENT_FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const ASSET_PREFETCH_TIMEOUT_MS = 5000;
const MAX_HEADSHOT_PREFETCH = 12;

export function normalizeRemoteUri(uri: string | undefined | null): string {
  if (typeof uri !== "string") {
    return "";
  }
  const trimmed = uri.trim();
  if (!trimmed || trimmed === TRANSPARENT_FALLBACK_IMAGE_URI) {
    return "";
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

export function isResolvedLogoUri(uri: string): boolean {
  return uri.startsWith("https://");
}

function pickTopHeadshots(players: LiveGamePlayer[]): string[] {
  return [...players]
    .sort(
      (a, b) =>
        (b.inGameRating10 ?? -1) - (a.inGameRating10 ?? -1) ||
        b.points - a.points ||
        b.minutes - a.minutes,
    )
    .map((player) => normalizeRemoteUri(player.headshot))
    .filter((uri) => uri.startsWith("https://"))
    .slice(0, MAX_HEADSHOT_PREFETCH);
}

export function getBootstrapAssetUris(data: LiveGameData | null): {
  requiredLogoUris: string[];
  optionalHeadshotUris: string[];
} {
  if (!data) {
    return { requiredLogoUris: [], optionalHeadshotUris: [] };
  }

  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const requiredLogoUris = [normalizeRemoteUri(away?.logo), normalizeRemoteUri(home?.logo)]
    .filter(Boolean)
    .filter(isResolvedLogoUri);

  const players = Object.values(data.playersByTeam ?? {}).flat();
  const optionalHeadshotUris = pickTopHeadshots(players);

  return { requiredLogoUris, optionalHeadshotUris };
}

async function prefetchWithTimeout(uri: string, timeoutMs: number): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<boolean>([
      Image.prefetch(uri),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function prefetchImageUris(
  uris: string[],
  timeoutMs = ASSET_PREFETCH_TIMEOUT_MS,
): Promise<Map<string, boolean>> {
  const uniqueUris = [...new Set(uris.filter(Boolean))];
  const results = await Promise.all(
    uniqueUris.map(async (uri) => [uri, await prefetchWithTimeout(uri, timeoutMs)] as const),
  );
  return new Map(results);
}

