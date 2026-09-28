import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type GameCardOriginSource = "live-games-card";

export type GameCardFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ActiveGameCardOrigin = {
  gameId: string;
  source: GameCardOriginSource;
  frame: GameCardFrame;
};

type GameCardOriginContextValue = {
  activeOrigin: ActiveGameCardOrigin | null;
  setGameCardFrame: (gameId: string, frame: GameCardFrame) => void;
  activateGameCardOrigin: (
    gameId: string,
    source: GameCardOriginSource,
    frame?: GameCardFrame | null,
  ) => boolean;
  clearActiveOrigin: () => void;
};

const GameCardOriginContext = createContext<GameCardOriginContextValue | null>(null);

export function GameCardOriginProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const framesRef = useRef<Record<string, GameCardFrame>>({});
  const [activeOrigin, setActiveOrigin] = useState<ActiveGameCardOrigin | null>(
    null,
  );

  const setGameCardFrame = useCallback((gameId: string, frame: GameCardFrame) => {
    if (!gameId || frame.width <= 0 || frame.height <= 0) {
      return;
    }
    framesRef.current[gameId] = frame;
  }, []);

  const activateGameCardOrigin = useCallback(
    (
      gameId: string,
      source: GameCardOriginSource,
      frame?: GameCardFrame | null,
    ): boolean => {
      const resolvedFrame = frame ?? framesRef.current[gameId] ?? null;
      if (!gameId || !resolvedFrame) {
        return false;
      }
      setActiveOrigin({
        gameId,
        source,
        frame: resolvedFrame,
      });
      return true;
    },
    [],
  );

  const clearActiveOrigin = useCallback(() => {
    setActiveOrigin(null);
  }, []);

  const value = useMemo(
    () => ({
      activeOrigin,
      setGameCardFrame,
      activateGameCardOrigin,
      clearActiveOrigin,
    }),
    [activateGameCardOrigin, activeOrigin, clearActiveOrigin, setGameCardFrame],
  );

  return (
    <GameCardOriginContext.Provider value={value}>
      {children}
    </GameCardOriginContext.Provider>
  );
}

export function useGameCardOrigin(): GameCardOriginContextValue {
  const context = useContext(GameCardOriginContext);
  if (!context) {
    throw new Error(
      "useGameCardOrigin must be used within GameCardOriginProvider",
    );
  }
  return context;
}
