import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getCollegeBaseballLeaderboard,
  getCollegeBaseballPlayerImpactProfile,
  getCollegeBaseballPlayerImpactProfiles,
} from "@/src/features/cbaseball/teamApi";
import type {
  BaseballImpactOutput,
  BaseballImpactTrendPoint,
  BaseballLeaderboardOptions,
  BaseballLeaderboardRow,
  BaseballSeasonPlayerProfile,
} from "@/src/ratings/baseball/types";

const DEFAULT_SEASON = new Date().getFullYear();

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function useAsyncResource<T>(
  deps: readonly unknown[],
  loader: () => Promise<T>,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loader();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load baseball impact data.");
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    loader()
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load baseball impact data.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, deps);

  return {
    data,
    loading,
    error,
    refresh,
  };
}

export function usePlayerImpactRating(input: {
  sport: "college-baseball";
  playerId?: string | null;
  teamId?: string | null;
  season?: number;
}): AsyncState<BaseballImpactOutput | null> & { profile: BaseballSeasonPlayerProfile | null } {
  const season = input.season ?? DEFAULT_SEASON;
  const enabled = Boolean(input.playerId && input.teamId);
  const resource = useAsyncResource(
    [input.playerId, input.teamId, season, enabled] as const,
    async () => {
      if (!enabled) {
        return null;
      }
      const profile = await getCollegeBaseballPlayerImpactProfile(
        input.playerId ?? "",
        input.teamId ?? "",
        season,
      );
      return profile;
    },
  );

  return {
    ...resource,
    data: resource.data?.output ?? null,
    profile: resource.data,
  };
}

export function useLeaderboard(input: {
  sport: "college-baseball";
  scope?: BaseballLeaderboardOptions["scope"];
  position?: string | null;
  role?: BaseballLeaderboardOptions["role"];
  teamId?: string | null;
  season?: number;
  limit?: number;
}): AsyncState<BaseballLeaderboardRow[]> {
  const season = input.season ?? DEFAULT_SEASON;
  return useAsyncResource(
    [season, input.scope, input.position, input.role, input.teamId, input.limit] as const,
    async () =>
      getCollegeBaseballLeaderboard(season, {
        scope: input.scope,
        position: input.position,
        role: input.role,
        teamId: input.teamId,
        limit: input.limit,
      }),
  );
}

export function usePlayerGameTrend(input: {
  sport: "college-baseball";
  playerId?: string | null;
  teamId?: string | null;
  season?: number;
}): AsyncState<BaseballImpactTrendPoint[]> & { profile: BaseballSeasonPlayerProfile | null } {
  const season = input.season ?? DEFAULT_SEASON;
  const enabled = Boolean(input.playerId && input.teamId);
  const resource = useAsyncResource(
    [input.playerId, input.teamId, season, enabled] as const,
    async () => {
      if (!enabled) {
        return null;
      }
      return getCollegeBaseballPlayerImpactProfile(
        input.playerId ?? "",
        input.teamId ?? "",
        season,
      );
    },
  );

  const trend = useMemo(
    () =>
      resource.data?.games.map((game) => ({
        gameId: game.game.gameId,
        date: game.game.date,
        opponent: game.game.opponent,
        rating: game.output.overallRating,
        role: game.role,
        impactShare: game.impactShare,
      })) ?? [],
    [resource.data],
  );

  return {
    ...resource,
    data: trend,
    profile: resource.data,
  };
}

export function useTeamImpactProfiles(input: {
  sport: "college-baseball";
  teamId?: string | null;
  season?: number;
}): AsyncState<BaseballSeasonPlayerProfile[]> {
  const season = input.season ?? DEFAULT_SEASON;
  const enabled = Boolean(input.teamId);
  return useAsyncResource(
    [input.teamId, season, enabled] as const,
    async () => {
      if (!enabled) {
        return [];
      }
      return getCollegeBaseballPlayerImpactProfiles(input.teamId ?? "", season);
    },
  );
}
