import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { InGameRouteKey } from "@/src/ui/inGameRoutes";

type InGameSectionRegistryValue = {
  availableSectionIdsByTab: Partial<Record<InGameRouteKey, string[]>>;
  registerAvailableSections: (tabKey: InGameRouteKey, ids: readonly string[]) => void;
  unregisterAvailableSections: (tabKey: InGameRouteKey) => void;
};

const InGameSectionRegistryContext = createContext<InGameSectionRegistryValue | null>(null);

export function InGameSectionRegistryProvider({ children }: { children: ReactNode }) {
  const [availableSectionIdsByTab, setAvailableSectionIdsByTab] = useState<
    Partial<Record<InGameRouteKey, string[]>>
  >({});

  const registerAvailableSections = useCallback((tabKey: InGameRouteKey, ids: readonly string[]) => {
    const nextIds = ids.filter((id, index, all) => all.indexOf(id) === index);
    setAvailableSectionIdsByTab((prev) => {
      const currentIds = prev[tabKey] ?? [];
      if (
        currentIds.length === nextIds.length &&
        currentIds.every((id, index) => id === nextIds[index])
      ) {
        return prev;
      }
      return {
        ...prev,
        [tabKey]: [...nextIds],
      };
    });
  }, []);

  const unregisterAvailableSections = useCallback((tabKey: InGameRouteKey) => {
    setAvailableSectionIdsByTab((prev) => {
      if (!(tabKey in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[tabKey];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      availableSectionIdsByTab,
      registerAvailableSections,
      unregisterAvailableSections,
    }),
    [availableSectionIdsByTab, registerAvailableSections, unregisterAvailableSections],
  );

  return (
    <InGameSectionRegistryContext.Provider value={value}>
      {children}
    </InGameSectionRegistryContext.Provider>
  );
}

export function useInGameSectionRegistry() {
  const context = useContext(InGameSectionRegistryContext);
  if (!context) {
    throw new Error("useInGameSectionRegistry must be used within InGameSectionRegistryProvider");
  }
  return context;
}
