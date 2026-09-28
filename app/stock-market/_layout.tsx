import { Stack } from "expo-router";

import { StockMarketDataProvider } from "@/src/features/stockmarket/StockMarketDataContext";
import { StockPortfolioProvider } from "@/src/features/stockmarket/StockPortfolioContext";

/**
 * Both Stock Market screens share one market feed and one portfolio, so the
 * providers are mounted here rather than at the app root — the WNBA roster
 * sweep and live price polling only run while this section is open.
 */
export default function StockMarketLayout() {
  return (
    <StockMarketDataProvider>
      <StockPortfolioProvider>
        <Stack
          screenOptions={{ headerShown: false, animation: "slide_from_right" }}
        />
      </StockPortfolioProvider>
    </StockMarketDataProvider>
  );
}
