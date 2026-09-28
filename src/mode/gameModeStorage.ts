import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GameMode } from "@/src/mode/gameModeTypes";

const GAME_MODE_STORAGE_KEY = "@boston-game/game-mode";
const GAME_MODE_STORAGE_VERSION = 1;
const DEFAULT_GAME_MODE: GameMode = "college";

type StoredGameModePayload = {
  version: number;
  mode: GameMode;
};

function sanitizeMode(value: unknown): GameMode {
  if (value === "nba" || value === "baseball") {
    return value;
  }
  return "college";
}

export async function loadGameMode(): Promise<GameMode> {
  try {
    const raw = await AsyncStorage.getItem(GAME_MODE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_GAME_MODE;
    }

    const payload = JSON.parse(raw) as Partial<StoredGameModePayload>;
    if (payload.version !== GAME_MODE_STORAGE_VERSION) {
      return DEFAULT_GAME_MODE;
    }

    return sanitizeMode(payload.mode);
  } catch {
    return DEFAULT_GAME_MODE;
  }
}

export async function saveGameMode(mode: GameMode): Promise<void> {
  const payload: StoredGameModePayload = {
    version: GAME_MODE_STORAGE_VERSION,
    mode: sanitizeMode(mode),
  };

  await AsyncStorage.setItem(GAME_MODE_STORAGE_KEY, JSON.stringify(payload));
}

export const DEFAULT_GAME_MODE_VALUE = DEFAULT_GAME_MODE;
