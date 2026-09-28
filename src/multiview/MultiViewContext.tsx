import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_MULTI_VIEW_STATE,
  loadMultiViewState,
  saveMultiViewState,
} from "@/src/multiview/multiViewStorage";
import type {
  AddMultiViewGameInput,
  AddMultiViewGameResult,
  MultiViewEntrySource,
  MultiViewState,
} from "@/src/multiview/multiViewTypes";
import {
  buildMultiViewGameKey,
  MAX_MULTI_VIEW_GAMES,
} from "@/src/multiview/multiViewTypes";
import type { GameMode } from "@/src/mode/gameModeTypes";

type MultiViewStateContextValue = MultiViewState & {
  isHydrated: boolean;
};

type MultiViewActionsContextValue = {
  addGameToMultiView: (input: AddMultiViewGameInput) => AddMultiViewGameResult;
  removeGameFromMultiView: (gameId: string, mode?: GameMode) => void;
  isGameInMultiView: (gameId: string, mode?: GameMode) => boolean;
  clearMultiView: () => void;
  setLastEntrySource: (source: MultiViewEntrySource) => void;
};

const MultiViewStateContext = createContext<MultiViewStateContextValue | null>(
  null,
);
const MultiViewActionsContext =
  createContext<MultiViewActionsContextValue | null>(null);

export function MultiViewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MultiViewState>(DEFAULT_MULTI_VIEW_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const stateRef = useRef<MultiViewState>(DEFAULT_MULTI_VIEW_STATE);
  const lastSavedRef = useRef("");

  const commitState = useCallback((nextState: MultiViewState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  useEffect(() => {
    let active = true;

    void loadMultiViewState().then((loadedState) => {
      if (!active) {
        return;
      }
      stateRef.current = loadedState;
      setState(loadedState);
      lastSavedRef.current = JSON.stringify(loadedState);
      setIsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) {
      return;
    }
    lastSavedRef.current = serialized;
    void saveMultiViewState(state);
  }, [isHydrated, state]);

  const actions = useMemo<MultiViewActionsContextValue>(
    () => ({
      addGameToMultiView: (input) => {
        const gameId =
          typeof input.gameId === "string" ? input.gameId.trim() : "";
        if (!gameId) {
          return { status: "invalid" };
        }

        const key = buildMultiViewGameKey(input.mode, gameId);
        const currentState = stateRef.current;
        const existingIndex = currentState.games.findIndex(
          (entry) => entry.key === key,
        );

        if (existingIndex >= 0) {
          const existing = currentState.games[existingIndex];
          if (input.snapshot) {
            const nextGames = [...currentState.games];
            nextGames[existingIndex] = {
              ...existing,
              snapshot: input.snapshot,
            };
            commitState({
              ...currentState,
              games: nextGames,
            });
          }
          return { status: "already_exists", key };
        }

        if (currentState.games.length >= MAX_MULTI_VIEW_GAMES) {
          return { status: "max_reached", max: MAX_MULTI_VIEW_GAMES };
        }

        const nextState: MultiViewState = {
          ...currentState,
          games: [
            ...currentState.games,
            {
              key,
              gameId,
              mode: input.mode,
              addedAt: new Date().toISOString(),
              snapshot: input.snapshot,
            },
          ],
        };
        commitState(nextState);
        return { status: "added", key };
      },
      removeGameFromMultiView: (gameId, mode) => {
        const normalizedGameId =
          typeof gameId === "string" ? gameId.trim() : "";
        if (!normalizedGameId) {
          return;
        }
        const currentState = stateRef.current;
        const nextGames = currentState.games.filter((entry) => {
          if (entry.gameId !== normalizedGameId) {
            return true;
          }
          if (mode) {
            return entry.mode !== mode;
          }
          return false;
        });

        if (nextGames.length === currentState.games.length) {
          return;
        }

        commitState({
          ...currentState,
          games: nextGames,
        });
      },
      isGameInMultiView: (gameId, mode) => {
        const normalizedGameId =
          typeof gameId === "string" ? gameId.trim() : "";
        if (!normalizedGameId) {
          return false;
        }
        return stateRef.current.games.some(
          (entry) =>
            entry.gameId === normalizedGameId &&
            (mode ? entry.mode === mode : true),
        );
      },
      clearMultiView: () => {
        const currentState = stateRef.current;
        if (currentState.games.length === 0) {
          return;
        }
        commitState({
          ...currentState,
          games: [],
        });
      },
      setLastEntrySource: (source) => {
        const currentState = stateRef.current;
        if (currentState.lastEntrySource === source) {
          return;
        }
        commitState({
          ...currentState,
          lastEntrySource: source,
        });
      },
    }),
    [commitState],
  );

  const stateValue = useMemo<MultiViewStateContextValue>(
    () => ({
      ...state,
      isHydrated,
    }),
    [isHydrated, state],
  );

  return (
    <MultiViewStateContext.Provider value={stateValue}>
      <MultiViewActionsContext.Provider value={actions}>
        {children}
      </MultiViewActionsContext.Provider>
    </MultiViewStateContext.Provider>
  );
}

export function useMultiViewState() {
  const context = useContext(MultiViewStateContext);
  if (!context) {
    throw new Error("useMultiViewState must be used within MultiViewProvider");
  }
  return context;
}

export function useMultiViewActions() {
  const context = useContext(MultiViewActionsContext);
  if (!context) {
    throw new Error("useMultiViewActions must be used within MultiViewProvider");
  }
  return context;
}

export function useMultiView() {
  const state = useMultiViewState();
  const actions = useMultiViewActions();
  return useMemo(
    () => ({
      ...state,
      ...actions,
    }),
    [actions, state],
  );
}

export { MAX_MULTI_VIEW_GAMES };
