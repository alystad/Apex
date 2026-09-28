import type { LiveGameListItem } from "@/src/features/basketball/api";
import type { GameMode } from "@/src/mode/gameModeTypes";

import {
  ALL_CONFERENCE_OPTION,
  COLLEGE_BASKETBALL_CONFERENCES,
  COLLEGE_FULL_CONFERENCE_OPTIONS,
  NBA_CONFERENCES,
  NBA_FULL_CONFERENCE_OPTIONS,
  OTHER_CONFERENCE_OPTION,
} from "@/src/conferences/conferenceCatalog";
import {
  ALL_CONFERENCE_KEY,
  OTHER_CONFERENCE_KEY,
  type ConferenceOption,
} from "@/src/conferences/conferenceFilterTypes";

type DerivedConference = ConferenceOption;

function getConferenceCatalog(mode: GameMode): readonly ConferenceOption[] {
  return mode === "nba"
    ? NBA_FULL_CONFERENCE_OPTIONS
    : COLLEGE_FULL_CONFERENCE_OPTIONS;
}

function getConferenceDefinitions(
  mode: GameMode,
): ReadonlyArray<{ key: string; label: string; aliases: readonly string[] }> {
  return mode === "nba" ? NBA_CONFERENCES : COLLEGE_BASKETBALL_CONFERENCES;
}

function normalizeConferenceLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveConferenceFromGame(
  game: LiveGameListItem,
  mode: GameMode,
): DerivedConference {
  return deriveConferencesFromGame(game, mode)[0] ?? OTHER_CONFERENCE_OPTION;
}

export function deriveConferencesFromGame(
  game: LiveGameListItem,
  mode: GameMode,
): DerivedConference[] {
  const rawLabels = [
    game.home.conference?.shortName?.trim(),
    game.home.conference?.name?.trim(),
    game.away.conference?.shortName?.trim(),
    game.away.conference?.name?.trim(),
    game.conference?.shortName?.trim(),
    game.conference?.name?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (rawLabels.length === 0) {
    return [OTHER_CONFERENCE_OPTION];
  }

  const matches = rawLabels
    .map((rawLabel) => {
      const normalized = normalizeConferenceLabel(rawLabel);
      const canonicalMatch = getConferenceDefinitions(mode).find((conference) =>
        conference.aliases.some(
          (alias) => normalizeConferenceLabel(alias) === normalized,
        ),
      );

      if (!canonicalMatch) {
        return null;
      }

      return {
        key: canonicalMatch.key,
        label: canonicalMatch.label,
      };
    })
    .filter((value): value is DerivedConference => value !== null)
    .filter((value, index, array) => array.findIndex((item) => item.key === value.key) === index);

  return matches.length > 0 ? matches : [OTHER_CONFERENCE_OPTION];
}

export function filterGamesByConference(
  games: LiveGameListItem[],
  selectedConferenceKey: string,
  mode: GameMode,
): LiveGameListItem[] {
  if (selectedConferenceKey === ALL_CONFERENCE_KEY) {
    return games;
  }

  return games.filter((game) => {
    return deriveConferencesFromGame(game, mode).some(
      (conference) => conference.key === selectedConferenceKey,
    );
  });
}

export function getConferenceOptionsFromGames(
  games: LiveGameListItem[],
  selectedConferenceKey: string,
  _selectedConferenceLabel: string | undefined,
  mode: GameMode,
): ConferenceOption[] {
  const allOptions = [...getConferenceCatalog(mode)];

  const hasOtherGames = games.some(
    (game) => deriveConferenceFromGame(game, mode).key === OTHER_CONFERENCE_KEY,
  );

  return allOptions.filter((option) => {
    if (option.key !== OTHER_CONFERENCE_KEY) {
      return true;
    }
    return hasOtherGames || selectedConferenceKey === OTHER_CONFERENCE_KEY;
  });
}
