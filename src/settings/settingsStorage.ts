import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEFAULT_SETTINGS_STATE } from "@/src/settings/settingsDefaults";
import type {
  CourtStyle,
  SettingsState,
  ThemeMode,
} from "@/src/settings/settingsTypes";
import { sanitizeInGameSectionLayoutsByTab } from "@/src/ui/inGameSectionLayouts";
import { sanitizeInGameTabLayout } from "@/src/ui/inGameTabs";

const SETTINGS_STORAGE_KEY = "@boston-game/settings";
const SETTINGS_STORAGE_VERSION = 1;

type StoredSettingsPayload = {
  version: number;
  state: SettingsState;
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark" || value === "team";
}

function isCourtStyle(value: unknown): value is CourtStyle {
  return value === "minimal" || value === "detailed";
}

function isInGameTab(value: unknown): value is SettingsState["inGame"]["defaultTab"] {
  return value === "court" || value === "stats" || value === "commentary";
}

function sanitizeLiveDataDelaySeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS_STATE.inGame.liveDataDelaySeconds;
  }
  return Math.max(0, Math.min(120, Math.round(value)));
}

export function sanitizeSettingsState(value: unknown): SettingsState {
  const raw = (value ?? {}) as Partial<SettingsState>;
  const rawInGame = (raw.inGame ?? {}) as Partial<SettingsState["inGame"]>;
  const rawSections = (rawInGame.sections ?? {}) as Partial<
    SettingsState["inGame"]["sections"]
  >;

  return {
    themeMode: isThemeMode(raw.themeMode)
      ? raw.themeMode
      : DEFAULT_SETTINGS_STATE.themeMode,
    courtStyle: isCourtStyle(raw.courtStyle)
      ? raw.courtStyle
      : DEFAULT_SETTINGS_STATE.courtStyle,
    useTeamColorsOnCourt:
      typeof raw.useTeamColorsOnCourt === "boolean"
        ? raw.useTeamColorsOnCourt
        : DEFAULT_SETTINGS_STATE.useTeamColorsOnCourt,
    inGame: {
      sections: {
        momentum:
          typeof rawSections.momentum === "boolean"
            ? rawSections.momentum
            : DEFAULT_SETTINGS_STATE.inGame.sections.momentum,
        liveImpact:
          typeof rawSections.liveImpact === "boolean"
            ? rawSections.liveImpact
            : DEFAULT_SETTINGS_STATE.inGame.sections.liveImpact,
        betting:
          typeof rawSections.betting === "boolean"
            ? rawSections.betting
            : DEFAULT_SETTINGS_STATE.inGame.sections.betting,
        commentary:
          typeof rawSections.commentary === "boolean"
            ? rawSections.commentary
            : DEFAULT_SETTINGS_STATE.inGame.sections.commentary,
      },
      defaultTab: isInGameTab(rawInGame.defaultTab)
        ? rawInGame.defaultTab
        : DEFAULT_SETTINGS_STATE.inGame.defaultTab,
      liveDataDelaySeconds: sanitizeLiveDataDelaySeconds(
        rawInGame.liveDataDelaySeconds,
      ),
      tabLayout: sanitizeInGameTabLayout(rawInGame.tabLayout),
      sectionLayoutsByTab: sanitizeInGameSectionLayoutsByTab(
        rawInGame.sectionLayoutsByTab,
      ),
    },
  };
}

export async function loadSettingsState(): Promise<SettingsState> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS_STATE;
    }

    const payload = JSON.parse(raw) as Partial<StoredSettingsPayload>;
    if (payload.version !== SETTINGS_STORAGE_VERSION) {
      return DEFAULT_SETTINGS_STATE;
    }

    return sanitizeSettingsState(payload.state);
  } catch {
    return DEFAULT_SETTINGS_STATE;
  }
}

export async function saveSettingsState(state: SettingsState): Promise<void> {
  const payload: StoredSettingsPayload = {
    version: SETTINGS_STORAGE_VERSION,
    state: sanitizeSettingsState(state),
  };

  await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}
