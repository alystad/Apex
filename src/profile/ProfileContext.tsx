import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_PROFILE_STATE } from "@/src/profile/profileDefaults";
import {
  setTrackedBetResultEntry,
  syncTrackedBetsWithSnapshots,
  toggleTrackedBetEntry,
  updateTrackedBetStakeEntry,
} from "@/src/features/betting/trackedBets";
import {
  arePredictionsEqual,
  createPredictionFromSnapshot,
  syncPredictionWithSnapshot,
} from "@/src/profile/predictionResolution";
import { loadProfileState, saveProfileState } from "@/src/profile/profileStorage";
import type {
  FavoriteTeamTheme,
  FavoriteGameSelection,
  ToggleFavoriteGameInput,
  LocalProfile,
  PredictionGameSnapshot,
  ProfileAction,
  ProfileState,
  TrackedBetCandidate,
  TrackedBetGameSnapshot,
  TrackedBetResult,
  TrackedBetSettlementSource,
} from "@/src/profile/profileTypes";
import { buildFavoriteGameKey } from "@/src/profile/profileTypes";

type ProfileStateContextValue = {
  state: ProfileState;
  isHydrated: boolean;
};

type ProfileActionsContextValue = {
  setDisplayName: (value: string) => void;
  setFavoriteTeam: (team?: FavoriteTeamTheme) => void;
  toggleGameFavorite: (input: ToggleFavoriteGameInput) => void;
  isGameFavorited: (mode: ToggleFavoriteGameInput["mode"], gameId: string) => boolean;
  savePrediction: (
    snapshot: PredictionGameSnapshot,
    pickedTeamId: string,
  ) => void;
  syncPredictionsFromSnapshots: (snapshots: PredictionGameSnapshot[]) => void;
  toggleTrackedBet: (candidate: TrackedBetCandidate) => void;
  updateTrackedBetStake: (key: string, stake: number) => void;
  setTrackedBetResult: (
    key: string,
    result: TrackedBetResult,
    settlementSource?: TrackedBetSettlementSource,
  ) => void;
  syncTrackedBetsFromSnapshots: (snapshots: TrackedBetGameSnapshot[]) => void;
};

const ProfileStateContext = createContext<ProfileStateContextValue | null>(null);
const ProfileActionsContext = createContext<ProfileActionsContextValue | null>(null);

function areProfilesEqual(left: LocalProfile, right: LocalProfile): boolean {
  return (
    left.displayName === right.displayName &&
    left.avatarUri === right.avatarUri &&
    left.favoriteTeamId === right.favoriteTeamId &&
    left.favoriteTeamTheme?.name === right.favoriteTeamTheme?.name &&
    left.favoriteTeamTheme?.logo === right.favoriteTeamTheme?.logo &&
    left.favoriteTeamTheme?.primaryColor === right.favoriteTeamTheme?.primaryColor &&
    left.favoriteTeamTheme?.secondaryColor === right.favoriteTeamTheme?.secondaryColor
  );
}

function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case "HYDRATE":
      return action.payload;
    case "SET_DISPLAY_NAME": {
      const nextName = action.payload.trim().slice(0, 32) || state.profile.displayName;
      if (nextName === state.profile.displayName) {
        return state;
      }
      return {
        ...state,
        profile: {
          ...state.profile,
          displayName: nextName,
        },
      };
    }
    case "SET_FAVORITE_TEAM": {
      if (
        state.profile.favoriteTeamId === action.payload?.teamId &&
        state.profile.favoriteTeamTheme?.name === action.payload?.name &&
        state.profile.favoriteTeamTheme?.logo === action.payload?.logo &&
        state.profile.favoriteTeamTheme?.primaryColor === action.payload?.primaryColor &&
        state.profile.favoriteTeamTheme?.secondaryColor === action.payload?.secondaryColor
      ) {
        return state;
      }
      return {
        ...state,
        profile: {
          ...state.profile,
          favoriteTeamId: action.payload?.teamId,
          favoriteTeamTheme: action.payload,
        },
      };
    }
    case "UPSERT_PREDICTION": {
      const existingIndex = state.predictions.findIndex(
        (prediction) =>
          prediction.gameId === action.payload.gameId &&
          prediction.mode === action.payload.mode,
      );

      if (existingIndex === -1) {
        return {
          ...state,
          predictions: [action.payload, ...state.predictions],
        };
      }

      const existingPrediction = state.predictions[existingIndex];
      if (arePredictionsEqual(existingPrediction, action.payload)) {
        return state;
      }

      const nextPredictions = [...state.predictions];
      nextPredictions[existingIndex] = action.payload;
      return {
        ...state,
        predictions: nextPredictions,
      };
    }
    case "SYNC_PREDICTIONS": {
      if (action.payload.length === 0 || state.predictions.length === 0) {
        return state;
      }

      const snapshotsByGameId = new Map(
        action.payload.map((snapshot) => [
          `${snapshot.mode}:${snapshot.gameId}`,
          snapshot,
        ]),
      );
      let changed = false;
      const nextPredictions = state.predictions.map((prediction) => {
        const snapshot = snapshotsByGameId.get(
          `${prediction.mode}:${prediction.gameId}`,
        );
        if (!snapshot) {
          return prediction;
        }
        const nextPrediction = syncPredictionWithSnapshot(prediction, snapshot);
        if (!arePredictionsEqual(prediction, nextPrediction)) {
          changed = true;
          return nextPrediction;
        }
        return prediction;
      });

      if (!changed) {
        return state;
      }

      return {
        ...state,
        predictions: nextPredictions,
      };
    }
    case "TOGGLE_GAME_FAVORITE": {
      const key = buildFavoriteGameKey(action.payload.mode, action.payload.gameId);
      const existingIndex = state.favoriteGames.findIndex((entry) => entry.key === key);
      if (existingIndex >= 0) {
        return {
          ...state,
          favoriteGames: state.favoriteGames.filter((entry) => entry.key !== key),
        };
      }

      const nextFavorite: FavoriteGameSelection = {
        key,
        mode: action.payload.mode,
        gameId: action.payload.gameId.trim(),
        addedAt: action.payload.addedAt ?? new Date().toISOString(),
        snapshot: action.payload.snapshot,
      };

      return {
        ...state,
        favoriteGames: [nextFavorite, ...state.favoriteGames],
      };
    }
    case "TOGGLE_TRACKED_BET": {
      const nextTrackedBets = toggleTrackedBetEntry(
        state.trackedBets,
        action.payload,
      );
      if (nextTrackedBets === state.trackedBets) {
        return state;
      }
      return {
        ...state,
        trackedBets: nextTrackedBets,
      };
    }
    case "UPDATE_TRACKED_BET_STAKE": {
      const nextTrackedBets = updateTrackedBetStakeEntry(
        state.trackedBets,
        action.payload.key,
        action.payload.stake,
      );
      if (nextTrackedBets === state.trackedBets) {
        return state;
      }
      return {
        ...state,
        trackedBets: nextTrackedBets,
      };
    }
    case "SET_TRACKED_BET_RESULT": {
      const nextTrackedBets = setTrackedBetResultEntry(
        state.trackedBets,
        action.payload.key,
        action.payload.result,
        action.payload.settlementSource,
      );
      if (nextTrackedBets === state.trackedBets) {
        return state;
      }
      return {
        ...state,
        trackedBets: nextTrackedBets,
      };
    }
    case "SYNC_TRACKED_BETS": {
      const nextTrackedBets = syncTrackedBetsWithSnapshots(
        state.trackedBets,
        action.payload,
      );
      if (nextTrackedBets === state.trackedBets) {
        return state;
      }
      return {
        ...state,
        trackedBets: nextTrackedBets,
      };
    }
    default:
      return state;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(profileReducer, DEFAULT_PROFILE_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSavedRef = useRef<string>("");
  const stateRef = useRef<ProfileState>(DEFAULT_PROFILE_STATE);

  useEffect(() => {
    let active = true;

    void loadProfileState().then((loadedState) => {
      if (!active) {
        return;
      }
      dispatch({ type: "HYDRATE", payload: loadedState });
      lastSavedRef.current = JSON.stringify(loadedState);
      stateRef.current = loadedState;
      setIsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) {
      return;
    }
    lastSavedRef.current = serialized;
    void saveProfileState(state);
  }, [isHydrated, state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const actions = useMemo<ProfileActionsContextValue>(
    () => ({
      setDisplayName: (value) =>
        dispatch({ type: "SET_DISPLAY_NAME", payload: value }),
      setFavoriteTeam: (team) =>
        dispatch({ type: "SET_FAVORITE_TEAM", payload: team }),
      toggleGameFavorite: (input) =>
        dispatch({ type: "TOGGLE_GAME_FAVORITE", payload: input }),
      isGameFavorited: (mode, gameId) => {
        const key = buildFavoriteGameKey(mode, gameId);
        return state.favoriteGames.some((entry) => entry.key === key);
      },
      savePrediction: (snapshot, pickedTeamId) => {
        const existingPrediction =
          stateRef.current.predictions.find(
            (prediction) =>
              prediction.gameId === snapshot.gameId &&
              prediction.mode === snapshot.mode,
          ) ??
          null;
        const nextPrediction = createPredictionFromSnapshot(
          snapshot,
          pickedTeamId,
          existingPrediction,
        );
        if (!nextPrediction) {
          return;
        }
        dispatch({ type: "UPSERT_PREDICTION", payload: nextPrediction });
      },
      syncPredictionsFromSnapshots: (snapshots) =>
        dispatch({ type: "SYNC_PREDICTIONS", payload: snapshots }),
      toggleTrackedBet: (candidate) =>
        dispatch({ type: "TOGGLE_TRACKED_BET", payload: candidate }),
      updateTrackedBetStake: (key, stake) =>
        dispatch({
          type: "UPDATE_TRACKED_BET_STAKE",
          payload: { key, stake },
        }),
      setTrackedBetResult: (key, result, settlementSource) =>
        dispatch({
          type: "SET_TRACKED_BET_RESULT",
          payload: { key, result, settlementSource },
        }),
      syncTrackedBetsFromSnapshots: (snapshots) =>
        dispatch({ type: "SYNC_TRACKED_BETS", payload: snapshots }),
    }),
    [state.favoriteGames],
  );

  const stateValue = useMemo(
    () => ({
      state,
      isHydrated,
    }),
    [isHydrated, state],
  );

  return (
    <ProfileStateContext.Provider value={stateValue}>
      <ProfileActionsContext.Provider value={actions}>
        {children}
      </ProfileActionsContext.Provider>
    </ProfileStateContext.Provider>
  );
}

export function useProfileState() {
  const context = useContext(ProfileStateContext);
  if (!context) {
    throw new Error("useProfileState must be used within ProfileProvider");
  }
  return context;
}

export function useProfileActions() {
  const context = useContext(ProfileActionsContext);
  if (!context) {
    throw new Error("useProfileActions must be used within ProfileProvider");
  }
  return context;
}

export function useProfile() {
  const stateContext = useProfileState();
  const actions = useProfileActions();

  return useMemo(
    () => ({
      ...stateContext,
      ...actions,
    }),
    [actions, stateContext],
  );
}
