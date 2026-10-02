export type GameMode = "college" | "nba" | "baseball";

export const GAME_MODE_OPTIONS: Array<{ key: GameMode; label: string }> = [
  { key: "college", label: "College" },
  { key: "baseball", label: "College Baseball" },
  { key: "nba", label: "Pro Basketball" },
];
