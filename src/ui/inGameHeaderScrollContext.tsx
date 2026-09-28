import { createContext, useContext } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

type InGameHeaderScrollContextValue = {
  sharedHeaderScrollY: SharedValue<number>;
};

const InGameHeaderScrollContext = createContext<InGameHeaderScrollContextValue | null>(null);

export function InGameHeaderScrollProvider({ children }: { children: React.ReactNode }) {
  const sharedHeaderScrollY = useSharedValue(0);

  return (
    <InGameHeaderScrollContext.Provider value={{ sharedHeaderScrollY }}>
      {children}
    </InGameHeaderScrollContext.Provider>
  );
}

export function useInGameHeaderScroll(): InGameHeaderScrollContextValue {
  const context = useContext(InGameHeaderScrollContext);
  if (!context) {
    throw new Error("useInGameHeaderScroll must be used within InGameHeaderScrollProvider");
  }
  return context;
}

