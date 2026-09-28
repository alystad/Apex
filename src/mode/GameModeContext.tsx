import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_GAME_MODE_VALUE,
  loadGameMode,
  saveGameMode,
} from "@/src/mode/gameModeStorage";
import type { GameMode } from "@/src/mode/gameModeTypes";

type GameModeStateContextValue = {
  mode: GameMode;
  isHydrated: boolean;
};

type GameModeActionsContextValue = {
  setMode: (mode: GameMode) => void;
};

const GameModeStateContext = createContext<GameModeStateContextValue | null>(
  null,
);
const GameModeActionsContext =
  createContext<GameModeActionsContextValue | null>(null);

export function GameModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<GameMode>(DEFAULT_GAME_MODE_VALUE);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSavedRef = useRef<GameMode>(DEFAULT_GAME_MODE_VALUE);

  useEffect(() => {
    let active = true;

    void loadGameMode().then((loadedMode) => {
      if (!active) {
        return;
      }
      setModeState(loadedMode);
      lastSavedRef.current = loadedMode;
      setIsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || lastSavedRef.current === mode) {
      return;
    }
    lastSavedRef.current = mode;
    void saveGameMode(mode);
  }, [isHydrated, mode]);

  const actions = useMemo<GameModeActionsContextValue>(
    () => ({
      setMode: (nextMode) => {
        setModeState((currentMode) =>
          currentMode === nextMode ? currentMode : nextMode,
        );
      },
    }),
    [],
  );

  const stateValue = useMemo(
    () => ({
      mode,
      isHydrated,
    }),
    [isHydrated, mode],
  );

  return (
    <GameModeStateContext.Provider value={stateValue}>
      <GameModeActionsContext.Provider value={actions}>
        {children}
      </GameModeActionsContext.Provider>
    </GameModeStateContext.Provider>
  );
}

export function useGameModeState() {
  const context = useContext(GameModeStateContext);
  if (!context) {
    throw new Error("useGameModeState must be used within GameModeProvider");
  }
  return context;
}

export function useGameModeActions() {
  const context = useContext(GameModeActionsContext);
  if (!context) {
    throw new Error("useGameModeActions must be used within GameModeProvider");
  }
  return context;
}

export function useGameMode() {
  const state = useGameModeState();
  const actions = useGameModeActions();

  return useMemo(
    () => ({
      ...state,
      ...actions,
    }),
    [actions, state],
  );
}
