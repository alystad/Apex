export type ProBasketballLeague = "nba" | "wnba";

export type ProBasketballLeagueConfig = {
  label: string;
  espnLeaguePath: string;
  fallbackTeamName: string;
  defaultGameId: string;
};

export const DEFAULT_PRO_BASKETBALL_LEAGUE: ProBasketballLeague = "wnba";

export const PRO_BASKETBALL_LEAGUES: Record<
  ProBasketballLeague,
  ProBasketballLeagueConfig
> = {
  nba: {
    label: "NBA",
    espnLeaguePath: "basketball/nba",
    fallbackTeamName: "NBA Team",
    defaultGameId: "401811003",
  },
  wnba: {
    label: "WNBA",
    espnLeaguePath: "basketball/wnba",
    fallbackTeamName: "WNBA Team",
    defaultGameId: "401857052",
  },
};

export function getProBasketballLeagueConfig(
  league: ProBasketballLeague,
): ProBasketballLeagueConfig {
  return PRO_BASKETBALL_LEAGUES[league];
}
