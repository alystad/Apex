import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { LiveGamePlayer } from "@/hooks/useLiveGame";

/** Kept as a plain string union here (rather than importing PlayerModal's
 * own ChartViewMode) so this context module doesn't need to pull in the
 * whole PlayerModal component tree just for a type. */
export type InGamePlayerModalChartMode = "rating" | "momentum" | "rank";

type InGamePlayerModalContextValue = {
  selectedPlayer: LiveGamePlayer | null;
  isPlayerModalOpen: boolean;
  /** Which chart page the modal opens on — see PlayerModal's own doc. */
  initialChartMode: InGamePlayerModalChartMode | undefined;
  openPlayerModal: (player: LiveGamePlayer, initialChartMode?: InGamePlayerModalChartMode) => void;
  closePlayerModal: () => void;
};

const InGamePlayerModalContext = createContext<InGamePlayerModalContextValue | null>(null);

export function InGamePlayerModalProvider({ children }: { children: React.ReactNode }) {
  const [selectedPlayer, setSelectedPlayer] = useState<LiveGamePlayer | null>(null);
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false);
  const [initialChartMode, setInitialChartMode] = useState<InGamePlayerModalChartMode | undefined>(
    undefined,
  );

  const openPlayerModal = useCallback(
    (player: LiveGamePlayer, chartMode?: InGamePlayerModalChartMode) => {
      if (!player || !player.id || !player.name) {
        return;
      }
      if (__DEV__) {
        console.log(`[timing] openPlayerModal (context) called ${player.id} @ ${performance.now().toFixed(1)}ms`);
        console.time(`[timing] player-modal-open:${player.id}`);
      }
      setSelectedPlayer(player);
      setInitialChartMode(chartMode);
      setIsPlayerModalOpen(true);
    },
    [],
  );

  const closePlayerModal = useCallback(() => {
    setIsPlayerModalOpen(false);
    setSelectedPlayer(null);
    setInitialChartMode(undefined);
  }, []);

  const value = useMemo(
    () => ({
      selectedPlayer,
      isPlayerModalOpen,
      initialChartMode,
      openPlayerModal,
      closePlayerModal,
    }),
    [closePlayerModal, initialChartMode, isPlayerModalOpen, openPlayerModal, selectedPlayer],
  );

  return <InGamePlayerModalContext.Provider value={value}>{children}</InGamePlayerModalContext.Provider>;
}

export function useInGamePlayerModal(): InGamePlayerModalContextValue {
  const context = useContext(InGamePlayerModalContext);
  if (!context) {
    throw new Error("useInGamePlayerModal must be used within InGamePlayerModalProvider");
  }
  return context;
}
