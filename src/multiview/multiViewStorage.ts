import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  MultiViewEntrySource,
  MultiViewGameSelection,
  MultiViewGameSnapshot,
  MultiViewState,
} from "@/src/multiview/multiViewTypes";
import {
  buildMultiViewGameKey,
  MAX_MULTI_VIEW_GAMES,
} from "@/src/multiview/multiViewTypes";
import type { GameMode } from "@/src/mode/gameModeTypes";

const MULTI_VIEW_STORAGE_KEY = "@boston-game/multiview-state";
const MULTI_VIEW_STORAGE_VERSION = 1;

type StoredMultiViewPayload = {
  version: number;
  state: MultiViewState;
};

export const DEFAULT_MULTI_VIEW_STATE: MultiViewState = {
  games: [],
  lastEntrySource: "normal",
};

function sanitizeMode(value: unknown): GameMode | null {
  if (value === "college" || value === "nba" || value === "baseball") {
    return value;
  }
  return null;
}

function sanitizeEntrySource(value: unknown): MultiViewEntrySource {
  return value === "multiview" ? "multiview" : "normal";
}

function sanitizeSnapshot(value: unknown): MultiViewGameSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<MultiViewGameSnapshot>;
  const parseText = (field: unknown): string | undefined =>
    typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;

  const sport = raw.sport === "baseball" ? "baseball" : raw.sport === "basketball" ? "basketball" : undefined;

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
    baseballState:
      raw.baseballState && typeof raw.baseballState === "object"
        ? raw.baseballState
        : null,
  };
}

function sanitizeGameSelection(value: unknown): MultiViewGameSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<MultiViewGameSelection>;
  const mode = sanitizeMode(raw.mode);
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
    key: buildMultiViewGameKey(mode, gameId),
    gameId,
    mode,
    addedAt,
    snapshot: sanitizeSnapshot(raw.snapshot),
  };
}

function sanitizeState(value: unknown): MultiViewState {
  if (!value || typeof value !== "object") {
    return DEFAULT_MULTI_VIEW_STATE;
  }

  const raw = value as Partial<MultiViewState>;
  const deduped = new Map<string, MultiViewGameSelection>();

  if (Array.isArray(raw.games)) {
    raw.games.forEach((entry) => {
      const sanitized = sanitizeGameSelection(entry);
      if (!sanitized) {
        return;
      }
      if (!deduped.has(sanitized.key) && deduped.size < MAX_MULTI_VIEW_GAMES) {
        deduped.set(sanitized.key, sanitized);
      }
    });
  }

  return {
    games: [...deduped.values()],
    lastEntrySource: sanitizeEntrySource(raw.lastEntrySource),
  };
}

export async function loadMultiViewState(): Promise<MultiViewState> {
  try {
    const raw = await AsyncStorage.getItem(MULTI_VIEW_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_MULTI_VIEW_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<StoredMultiViewPayload>;
    if (parsed.version !== MULTI_VIEW_STORAGE_VERSION) {
      return DEFAULT_MULTI_VIEW_STATE;
    }

    return sanitizeState(parsed.state);
  } catch {
    return DEFAULT_MULTI_VIEW_STATE;
  }
}

export async function saveMultiViewState(state: MultiViewState): Promise<void> {
  const payload: StoredMultiViewPayload = {
    version: MULTI_VIEW_STORAGE_VERSION,
    state: sanitizeState(state),
  };
  await AsyncStorage.setItem(MULTI_VIEW_STORAGE_KEY, JSON.stringify(payload));
}
