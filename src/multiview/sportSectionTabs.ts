import type { TabItem } from "@/components/ui/TabBar";
import {
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";
import type { GameMode } from "@/src/mode/gameModeTypes";

export type SportsSectionTabKey = GameMode | "multiview";

type BuildSportsSectionTabItemsInput = {
  proLeague: ProBasketballLeague;
  onSelectMode: (mode: GameMode) => void;
  onOpenMultiView: () => void;
};

export function buildSportsSectionTabItems({
  proLeague,
  onSelectMode,
  onOpenMultiView,
}: BuildSportsSectionTabItemsInput): TabItem[] {
  return [
    {
      key: "college",
      label: "College",
      onPress: () => onSelectMode("college"),
    },
    {
      key: "baseball",
      label: "College Baseball",
      onPress: () => onSelectMode("baseball"),
    },
    {
      key: "nba",
      label: getProBasketballLeagueConfig(proLeague).label,
      onPress: () => onSelectMode("nba"),
    },
    {
      key: "multiview",
      label: "MultiView",
      onPress: onOpenMultiView,
    },
  ];
}
