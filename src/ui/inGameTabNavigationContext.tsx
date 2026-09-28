import { createContext, useContext } from "react";

import type { InGameRouteKey } from "@/src/ui/inGameRoutes";

type InGameTabNavigationContextValue = {
  goToTab: (tabKey: InGameRouteKey) => boolean;
  activeTabKey: InGameRouteKey | null;
  setSwipeEnabled: (enabled: boolean) => void;
  contentScrollEnabled: boolean;
  setContentScrollEnabled: (enabled: boolean) => void;
};

const InGameTabNavigationContext =
  createContext<InGameTabNavigationContextValue | null>(null);

export function InGameTabNavigationProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: InGameTabNavigationContextValue;
}) {
  return (
    <InGameTabNavigationContext.Provider value={value}>
      {children}
    </InGameTabNavigationContext.Provider>
  );
}

export function useInGameTabNavigation(): InGameTabNavigationContextValue {
  const context = useContext(InGameTabNavigationContext);
  if (!context) {
    throw new Error(
      "useInGameTabNavigation must be used within InGameTabNavigationProvider",
    );
  }
  return context;
}
