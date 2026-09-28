import type { LocalProfile, ProfileState } from "@/src/profile/profileTypes";

export const DEFAULT_LOCAL_PROFILE: LocalProfile = {
  displayName: "GameDay Scout",
};

export const DEFAULT_PROFILE_STATE: ProfileState = {
  profile: DEFAULT_LOCAL_PROFILE,
  predictions: [],
  favoriteGames: [],
  trackedBets: [],
};
