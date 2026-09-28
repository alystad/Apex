import { addDays, format, parseISO } from "date-fns";

import type { BettingGame } from "@/src/features/betting/types";

type TeamMatchInput = {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
};

type MatchCandidate = {
  event: BettingGame;
  score: number;
};

const TEAM_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhawai i\b/g, "hawaii"],
  [/\bhawai\b/g, "hawaii"],
  [/\bole miss\b/g, "mississippi"],
  [/\buconn\b/g, "connecticut"],
  [/\bunc\b/g, "north carolina"],
  [/\bumkc\b/g, "kansas city"],
  [/\bse louisiana\b/g, "southeastern louisiana"],
  [/\bucf\b/g, "central florida"],
  [/\bunlv\b/g, "nevada las vegas"],
  [/\bbyu\b/g, "brigham young"],
  [/\blsu\b/g, "louisiana state"],
  [/\bcal state\b/g, "csu"],
  [/\bcsu\b/g, "cal state"],
  [/\bcal baptist\b/g, "california baptist"],
  [/\bst johns\b/g, "saint johns"],
  [/\bst marys\b/g, "saint marys"],
  [/\bst thomas\b/g, "saint thomas"],
  [/\bstate\b/g, "st"],
];

function normalizeTeamName(value: string | undefined): string {
  const initial = (value ?? "")
    .toLowerCase()
    .replace(/#[0-9]+/g, "")
    .replace(/[’']/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(university|college)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!initial) {
    return "";
  }

  return TEAM_ALIAS_REPLACEMENTS.reduce((current, [pattern, replacement]) => {
    return current.replace(pattern, replacement).replace(/\s+/g, " ").trim();
  }, initial);
}

function buildNameVariants(team: TeamMatchInput): string[] {
  const rawNames = [
    team.displayName,
    team.shortDisplayName,
    team.abbreviation,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const variants = new Set<string>();

  rawNames.forEach((name) => {
    const normalized = normalizeTeamName(name);
    if (!normalized) {
      return;
    }

    variants.add(normalized);

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length > 1) {
      variants.add(tokens.slice(0, -1).join(" "));
      variants.add(tokens[0]);
    }

    if (normalized.includes(" saint ")) {
      variants.add(normalized.replace(/\bsaint\b/g, "st"));
    }
    if (normalized.includes(" st ")) {
      variants.add(normalized.replace(/\bst\b/g, "saint"));
    }
    if (normalized.includes(" cal state ")) {
      variants.add(normalized.replace(/\bcal state\b/g, "csu"));
    }
    if (normalized.includes(" csu ")) {
      variants.add(normalized.replace(/\bcsu\b/g, "cal state"));
    }
  });

  return [...variants].filter((value) => value.length > 0);
}

function bestNameScore(leftNames: string[], rightNames: string[]): number {
  let bestScore = 0;

  leftNames.forEach((left) => {
    rightNames.forEach((right) => {
      if (!left || !right) {
        return;
      }

      if (left === right) {
        bestScore = Math.max(bestScore, 100);
        return;
      }

      if (left.includes(right) || right.includes(left)) {
        bestScore = Math.max(bestScore, 78);
        return;
      }

      const leftTokens = new Set(left.split(" ").filter(Boolean));
      const rightTokens = new Set(right.split(" ").filter(Boolean));
      const overlap = [...leftTokens].filter((token) => rightTokens.has(token));
      if (overlap.length >= 2) {
        bestScore = Math.max(bestScore, 60 + overlap.length * 6);
        return;
      }

      if (
        overlap.length === 1 &&
        overlap[0] !== undefined &&
        overlap[0].length >= 5 &&
        (leftTokens.size <= 2 || rightTokens.size <= 2)
      ) {
        bestScore = Math.max(bestScore, 58);
      }
    });
  });

  return bestScore;
}

function timeScore(commenceTime: string | undefined, targetStartDateTime: string | undefined): number {
  if (!commenceTime || !targetStartDateTime) {
    return 0;
  }

  const commence = Date.parse(commenceTime);
  const target = Date.parse(targetStartDateTime);
  if (!Number.isFinite(commence) || !Number.isFinite(target)) {
    return 0;
  }

  const diffHours = Math.abs(commence - target) / (1000 * 60 * 60);
  if (diffHours <= 0.5) return 18;
  if (diffHours <= 2) return 14;
  if (diffHours <= 6) return 10;
  if (diffHours <= 12) return 6;
  if (diffHours <= 24) return 2;
  return 0;
}

function scoreEventMatch(params: {
  event: BettingGame;
  homeTeam: TeamMatchInput;
  awayTeam: TeamMatchInput;
  startDateTime?: string;
  reversed?: boolean;
}): number {
  const { event, homeTeam, awayTeam, startDateTime, reversed = false } = params;
  const homeInput = reversed ? awayTeam : homeTeam;
  const awayInput = reversed ? homeTeam : awayTeam;

  const eventHomeNames = buildNameVariants({
    displayName: event.homeTeam,
    shortDisplayName: event.homeTeam,
  });
  const eventAwayNames = buildNameVariants({
    displayName: event.awayTeam,
    shortDisplayName: event.awayTeam,
  });
  const appHomeNames = buildNameVariants(homeInput);
  const appAwayNames = buildNameVariants(awayInput);

  const homeScore = bestNameScore(appHomeNames, eventHomeNames);
  const awayScore = bestNameScore(appAwayNames, eventAwayNames);

  if (homeScore < 58 || awayScore < 58) {
    return 0;
  }

  return homeScore + awayScore + timeScore(event.commenceTime, startDateTime) - (reversed ? 4 : 0);
}

export function findOddsEventForGame(
  games: BettingGame[],
  input: {
    homeTeam: TeamMatchInput;
    awayTeam: TeamMatchInput;
    startDateTime?: string;
  },
): BettingGame | null {
  const candidates: MatchCandidate[] = [];

  games.forEach((event) => {
    const directScore = scoreEventMatch({
      event,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      startDateTime: input.startDateTime,
    });
    if (directScore > 0) {
      candidates.push({ event, score: directScore });
    }

    const reversedScore = scoreEventMatch({
      event,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      startDateTime: input.startDateTime,
      reversed: true,
    });
    if (reversedScore > 0) {
      candidates.push({ event, score: reversedScore });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 118 ? candidates[0].event : null;
}

export function dateCandidates(startDateIso: string | undefined): string[] {
  if (!startDateIso) {
    return [format(new Date(), "yyyy-MM-dd")];
  }

  const parsed = parseISO(startDateIso);
  if (Number.isNaN(parsed.getTime())) {
    return [format(new Date(), "yyyy-MM-dd")];
  }

  return [-1, 0, 1].map((offset) =>
    format(addDays(parsed, offset), "yyyy-MM-dd"),
  );
}
