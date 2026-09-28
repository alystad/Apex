import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  ALL_CONFERENCE_KEY,
  type ConferenceFilterState,
} from "@/src/conferences/conferenceFilterTypes";

const CONFERENCE_FILTER_STORAGE_KEY = "@boston-game/conference-filter";
const CONFERENCE_FILTER_STORAGE_VERSION = 2;

type StoredConferenceFilterPayload = {
  version: number;
  state: ConferenceFilterState;
};

export const DEFAULT_CONFERENCE_FILTER_STATE: ConferenceFilterState = {
  selectedConferenceKey: ALL_CONFERENCE_KEY,
  selectedConferenceLabel: "All",
};

function sanitizeConferenceFilterState(
  value: unknown,
): ConferenceFilterState {
  const raw = (value ?? {}) as Partial<ConferenceFilterState>;
  const selectedConferenceKey =
    typeof raw.selectedConferenceKey === "string" &&
    raw.selectedConferenceKey.trim().length > 0
      ? raw.selectedConferenceKey.trim()
      : DEFAULT_CONFERENCE_FILTER_STATE.selectedConferenceKey;
  const selectedConferenceLabel =
    typeof raw.selectedConferenceLabel === "string" &&
    raw.selectedConferenceLabel.trim().length > 0
      ? raw.selectedConferenceLabel.trim()
      : selectedConferenceKey === ALL_CONFERENCE_KEY
        ? "All"
        : DEFAULT_CONFERENCE_FILTER_STATE.selectedConferenceLabel;

  return {
    selectedConferenceKey,
    selectedConferenceLabel,
  };
}

export async function loadConferenceFilterState(): Promise<ConferenceFilterState> {
  try {
    const raw = await AsyncStorage.getItem(CONFERENCE_FILTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CONFERENCE_FILTER_STATE;
    }

    const payload = JSON.parse(raw) as Partial<StoredConferenceFilterPayload>;
    if (payload.version !== CONFERENCE_FILTER_STORAGE_VERSION) {
      return DEFAULT_CONFERENCE_FILTER_STATE;
    }

    return sanitizeConferenceFilterState(payload.state);
  } catch {
    return DEFAULT_CONFERENCE_FILTER_STATE;
  }
}

export async function saveConferenceFilterState(
  state: ConferenceFilterState,
): Promise<void> {
  const payload: StoredConferenceFilterPayload = {
    version: CONFERENCE_FILTER_STORAGE_VERSION,
    state: sanitizeConferenceFilterState(state),
  };

  await AsyncStorage.setItem(
    CONFERENCE_FILTER_STORAGE_KEY,
    JSON.stringify(payload),
  );
}
