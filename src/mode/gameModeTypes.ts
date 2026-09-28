import { PRO_BASKETBALL_LABEL } from "@/src/features/nba/proBasketballLeague";

export type GameMode = "college" | "nba" | "baseball";

export const GAME_MODE_OPTIONS: Array<{ key: GameMode; label: string }> = [
  { key: "college", label: "College" },
  { key: "baseball", label: "College Baseball" },
  { key: "nba", label: PRO_BASKETBALL_LABEL },
];
