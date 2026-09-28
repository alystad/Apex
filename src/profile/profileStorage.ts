import AsyncStorage from "@react-native-async-storage/async-storage";

import { sanitizeTrackedBetRecord } from "@/src/features/betting/trackedBets";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { DEFAULT_LOCAL_PROFILE } from "@/src/profile/profileDefaults";
import type {
  FavoriteTeamTheme,
  FavoriteGameSelection,
  FavoriteGameSnapshot,
  GamePrediction,
  LocalProfile,
  PredictionGameStatus,
  PredictionResult,
  ProfileState,
  TrackedProEvBet,
} from "@/src/profile/profileTypes";
import { buildFavoriteGameKey } from "@/src/profile/profileTypes";

const PROFILE_STORAGE_VERSION = 3;
const LEGACY_PROFILE_STORAGE_VERSION = 2;
const PROFILE_STORAGE_KEY = "@boston-game/profile";
const PREDICTIONS_STORAGE_KEY = "@boston-game/predictions";
const FAVORITE_GAMES_STORAGE_KEY = "@boston-game/favorite-games";
const TRACKED_BETS_STORAGE_KEY = "@boston-game/tracked-bets";

type VersionedPayload<T> = {
  version: number;
  value: T;
};

function isPredictionGameStatus(value: unknown): value is PredictionGameStatus {
  return value === "pre" || value === "live" || value === "final";
}

function isPredictionResult(value: unknown): value is PredictionResult {
  return value === "pending" || value === "correct" || value === "incorrect";
}

function isGameMode(value: unknown): value is GameMode {
  return value === "college" || value === "nba" || value === "baseball";
}

function sanitizeProfile(value: unknown): LocalProfile {
  const raw = (value ?? {}) as Partial<LocalProfile>;
  const displayName =
    typeof raw.displayName === "string" && raw.displayName.trim().length > 0
      ? raw.displayName.trim().slice(0, 32)
      : DEFAULT_LOCAL_PROFILE.displayName;

  const favoriteTeamThemeRaw = raw.favoriteTeamTheme as Partial<FavoriteTeamTheme> | undefined;
  const favoriteTeamTheme =
    favoriteTeamThemeRaw &&
    typeof favoriteTeamThemeRaw.teamId === "string" &&
    favoriteTeamThemeRaw.teamId.trim().length > 0
      ? {
          teamId: favoriteTeamThemeRaw.teamId.trim(),
          name:
            typeof favoriteTeamThemeRaw.name === "string" &&
            favoriteTeamThemeRaw.name.trim().length > 0
              ? favoriteTeamThemeRaw.name.trim()
              : undefined,
          shortName:
            typeof favoriteTeamThemeRaw.shortName === "string" &&
            favoriteTeamThemeRaw.shortName.trim().length > 0
              ? favoriteTeamThemeRaw.shortName.trim()
              : undefined,
          logo:
            typeof favoriteTeamThemeRaw.logo === "string" &&
            favoriteTeamThemeRaw.logo.trim().length > 0
              ? favoriteTeamThemeRaw.logo.trim()
              : undefined,
          primaryColor:
            typeof favoriteTeamThemeRaw.primaryColor === "string" &&
            favoriteTeamThemeRaw.primaryColor.trim().length > 0
              ? favoriteTeamThemeRaw.primaryColor.trim()
              : undefined,
          secondaryColor:
            typeof favoriteTeamThemeRaw.secondaryColor === "string" &&
            favoriteTeamThemeRaw.secondaryColor.trim().length > 0
              ? favoriteTeamThemeRaw.secondaryColor.trim()
              : undefined,
        }
      : undefined;

  return {
    displayName,
    avatarUri:
      typeof raw.avatarUri === "string" && raw.avatarUri.trim().length > 0
        ? raw.avatarUri.trim()
        : undefined,
    favoriteTeamId:
      typeof raw.favoriteTeamId === "string" && raw.favoriteTeamId.trim().length > 0
        ? raw.favoriteTeamId.trim()
        : favoriteTeamTheme?.teamId,
    favoriteTeamTheme,
  };
}

function sanitizePrediction(value: unknown): GamePrediction | null {
  const raw = (value ?? {}) as Partial<GamePrediction>;
  const requiredStringKeys: Array<keyof GamePrediction> = [
    "gameId",
    "pickedTeamId",
    "pickedTeamName",
    "homeTeamId",
    "awayTeamId",
    "homeTeamName",
    "awayTeamName",
    "gameDate",
    "createdAt",
    "updatedAt",
  ];

  const missingRequired = requiredStringKeys.some((key) => {
    const nextValue = raw[key];
    return typeof nextValue !== "string" || nextValue.trim().length === 0;
  });
  if (missingRequired) {
    return null;
  }

  if (
    !isPredictionGameStatus(raw.gameStatus) ||
    !isPredictionResult(raw.result) ||
    !isGameMode(raw.mode)
  ) {
    return null;
  }

  return {
    mode: raw.mode,
    gameId: raw.gameId!.trim(),
    pickedTeamId: raw.pickedTeamId!.trim(),
    pickedTeamName: raw.pickedTeamName!.trim(),
    homeTeamId: raw.homeTeamId!.trim(),
    awayTeamId: raw.awayTeamId!.trim(),
    homeTeamName: raw.homeTeamName!.trim(),
    awayTeamName: raw.awayTeamName!.trim(),
    gameDate: raw.gameDate!.trim(),
    conference:
      typeof raw.conference === "string" && raw.conference.trim().length > 0
        ? raw.conference.trim()
        : undefined,
    gameStatus: raw.gameStatus,
    actualWinnerTeamId:
      typeof raw.actualWinnerTeamId === "string" &&
      raw.actualWinnerTeamId.trim().length > 0
        ? raw.actualWinnerTeamId.trim()
        : undefined,
    result: raw.result,
    createdAt: raw.createdAt!.trim(),
    updatedAt: raw.updatedAt!.trim(),
  };
}

function sanitizeFavoriteSnapshot(value: unknown): FavoriteGameSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<FavoriteGameSnapshot>;
  const parseText = (field: unknown): string | undefined =>
    typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;

  const sport =
    raw.sport === "baseball"
      ? "baseball"
      : raw.sport === "basketball"
        ? "basketball"
        : undefined;

  return {
    sport,
    awayName: parseText(raw.awayName),
    homeName: parseText(raw.homeName),
    awayLogo: parseText(raw.awayLogo),
    homeLogo: parseText(raw.homeLogo),
    awayScore: parseText(raw.awayScore),
    homeScore: parseText(raw.homeScore),
    statusText: parseText(raw.statusText),
    venue: parseText(raw.venue),
    startDateTime: parseText(raw.startDateTime),
  };
}

function sanitizeFavoriteGameSelection(value: unknown): FavoriteGameSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<FavoriteGameSelection>;
  const mode = isGameMode(raw.mode) ? raw.mode : null;
  const gameId =
    typeof raw.gameId === "string" && raw.gameId.trim().length > 0
      ? raw.gameId.trim()
      : "";

  if (!mode || !gameId) {
    return null;
  }

  const addedAt =
    typeof raw.addedAt === "string" && raw.addedAt.trim().length > 0
      ? raw.addedAt.trim()
      : new Date().toISOString();

  return {
    key: buildFavoriteGameKey(mode, gameId),
    mode,
    gameId,
    addedAt,
    snapshot: sanitizeFavoriteSnapshot(raw.snapshot),
  };
}

function isSupportedStorageVersion(version: unknown): boolean {
  return (
    version === PROFILE_STORAGE_VERSION || version === LEGACY_PROFILE_STORAGE_VERSION
  );
}

export async function loadProfileState(): Promise<ProfileState> {
  try {
    const [profileRaw, predictionsRaw, favoriteGamesRaw, trackedBetsRaw] =
      await Promise.all([
      AsyncStorage.getItem(PROFILE_STORAGE_KEY),
      AsyncStorage.getItem(PREDICTIONS_STORAGE_KEY),
      AsyncStorage.getItem(FAVORITE_GAMES_STORAGE_KEY),
      AsyncStorage.getItem(TRACKED_BETS_STORAGE_KEY),
    ]);

    const profilePayload = profileRaw
      ? (JSON.parse(profileRaw) as VersionedPayload<LocalProfile>)
      : null;
    const predictionsPayload = predictionsRaw
      ? (JSON.parse(predictionsRaw) as VersionedPayload<GamePrediction[]>)
      : null;
    const favoriteGamesPayload = favoriteGamesRaw
      ? (JSON.parse(favoriteGamesRaw) as VersionedPayload<FavoriteGameSelection[]>)
      : null;
    const trackedBetsPayload = trackedBetsRaw
      ? (JSON.parse(trackedBetsRaw) as VersionedPayload<TrackedProEvBet[]>)
      : null;

    const profile =
      profilePayload && isSupportedStorageVersion(profilePayload.version)
        ? sanitizeProfile(profilePayload.value)
        : DEFAULT_LOCAL_PROFILE;

    const predictions =
      predictionsPayload &&
      isSupportedStorageVersion(predictionsPayload.version) &&
      Array.isArray(predictionsPayload.value)
        ? predictionsPayload.value
            .map((entry) => sanitizePrediction(entry))
            .filter((entry): entry is GamePrediction => entry !== null)
        : [];
    const favoriteGames =
      favoriteGamesPayload &&
      isSupportedStorageVersion(favoriteGamesPayload.version) &&
      Array.isArray(favoriteGamesPayload.value)
        ? (() => {
            const deduped = new Map<string, FavoriteGameSelection>();
            favoriteGamesPayload.value.forEach((entry) => {
              const sanitized = sanitizeFavoriteGameSelection(entry);
              if (!sanitized) {
                return;
              }
              if (!deduped.has(sanitized.key)) {
                deduped.set(sanitized.key, sanitized);
              }
            });
            return [...deduped.values()];
          })()
        : [];
    const trackedBets =
      trackedBetsPayload?.version === PROFILE_STORAGE_VERSION &&
      Array.isArray(trackedBetsPayload.value)
        ? (() => {
            const deduped = new Map<string, TrackedProEvBet>();
            trackedBetsPayload.value.forEach((entry) => {
              const sanitized = sanitizeTrackedBetRecord(entry);
              if (!sanitized) {
                return;
              }
              deduped.set(sanitized.key, sanitized);
            });
            return [...deduped.values()];
          })()
        : [];

    return {
      profile,
      predictions,
      favoriteGames,
      trackedBets,
    };
  } catch {
    return {
      profile: DEFAULT_LOCAL_PROFILE,
      predictions: [],
      favoriteGames: [],
      trackedBets: [],
    };
  }
}

export async function saveProfileState(state: ProfileState): Promise<void> {
  const profilePayload: VersionedPayload<LocalProfile> = {
    version: PROFILE_STORAGE_VERSION,
    value: sanitizeProfile(state.profile),
  };
  const predictionsPayload: VersionedPayload<GamePrediction[]> = {
    version: PROFILE_STORAGE_VERSION,
    value: state.predictions
      .map((entry) => sanitizePrediction(entry))
      .filter((entry): entry is GamePrediction => entry !== null),
  };
  const favoriteGamesPayload: VersionedPayload<FavoriteGameSelection[]> = {
    version: PROFILE_STORAGE_VERSION,
    value: state.favoriteGames
      .map((entry) => sanitizeFavoriteGameSelection(entry))
      .filter((entry): entry is FavoriteGameSelection => entry !== null),
  };
  const trackedBetsPayload: VersionedPayload<TrackedProEvBet[]> = {
    version: PROFILE_STORAGE_VERSION,
    value: state.trackedBets
      .map((entry) => sanitizeTrackedBetRecord(entry))
      .filter((entry): entry is TrackedProEvBet => entry !== null),
  };

  await Promise.all([
    AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profilePayload)),
    AsyncStorage.setItem(
      PREDICTIONS_STORAGE_KEY,
      JSON.stringify(predictionsPayload),
    ),
    AsyncStorage.setItem(
      FAVORITE_GAMES_STORAGE_KEY,
      JSON.stringify(favoriteGamesPayload),
    ),
    AsyncStorage.setItem(
      TRACKED_BETS_STORAGE_KEY,
      JSON.stringify(trackedBetsPayload),
    ),
  ]);
}
