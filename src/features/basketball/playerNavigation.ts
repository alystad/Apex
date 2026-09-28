import type { Href } from "expo-router";

import type { LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";
import type { GameMode } from "@/src/mode/gameModeTypes";

export type PlayerProfileRouteParams = {
  playerId: string;
  mode?: GameMode;
  teamId?: string;
  teamName?: string;
  teamLogo?: string;
  teamRecord?: string;
  conferenceName?: string;
  gameId?: string;
  fromGame?: string;
  playerName?: string;
  headshot?: string;
  jersey?: string;
  position?: string;
  liveRating?: string;
  seasonRating?: string;
};

type BuildPlayerProfileHrefInput = {
  player: Pick<
    LiveGamePlayer,
    | "id"
    | "name"
    | "teamId"
    | "headshot"
    | "jersey"
    | "position"
    | "inGameRating10"
    | "seasonRating10"
  >;
  mode?: GameMode;
  gameId?: string;
  team?: Pick<LiveGameTeam, "id" | "displayName" | "shortDisplayName" | "logo" | "record" | "conference"> | null;
};

function safeParam(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeNumberParam(value: number | null | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(1)
    : undefined;
}

export function buildPlayerProfileHref({
  player,
  mode,
  gameId,
  team,
}: BuildPlayerProfileHrefInput): Href {
  const params: PlayerProfileRouteParams = {
    playerId: player.id,
    mode,
    teamId: safeParam(player.teamId) ?? safeParam(team?.id),
    teamName:
      safeParam(team?.displayName) ??
      safeParam(team?.shortDisplayName),
    teamLogo: safeParam(team?.logo),
    teamRecord: safeParam(team?.record),
    conferenceName: safeParam(team?.conference?.shortName ?? team?.conference?.name),
    gameId: safeParam(gameId),
    fromGame: gameId ? "1" : undefined,
    playerName: safeParam(player.name),
    headshot: safeParam(player.headshot),
    jersey: safeParam(player.jersey),
    position: safeParam(player.position),
    liveRating: safeNumberParam(player.inGameRating10),
    seasonRating: safeNumberParam(player.seasonRating10),
  };

  return {
    pathname: "/player/[playerId]",
    params,
  } as Href;
}
