export const ALL_CONFERENCE_KEY = "all";
export const OTHER_CONFERENCE_KEY = "other";

export type ConferenceOption = {
  key: string;
  label: string;
};

export type ConferenceFilterState = {
  selectedConferenceKey: string;
  selectedConferenceLabel: string;
};

export type ConferenceFilterAction =
  | { type: "HYDRATE"; payload: ConferenceFilterState }
  | { type: "SET_SELECTED_CONFERENCE"; payload: ConferenceOption }
  | { type: "RESET" };
