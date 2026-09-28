import { useEffect } from "react";

import type { InGameRouteKey } from "@/src/ui/inGameRoutes";
import { useInGameSectionRegistry } from "@/src/ui/inGameSectionRegistryContext";

export function useRegisterInGameSections(
  tabKey: InGameRouteKey,
  ids: readonly string[],
) {
  const { registerAvailableSections, unregisterAvailableSections } = useInGameSectionRegistry();

  useEffect(() => {
    registerAvailableSections(tabKey, ids);
    return () => {
      unregisterAvailableSections(tabKey);
    };
  }, [ids, registerAvailableSections, tabKey, unregisterAvailableSections]);
}
