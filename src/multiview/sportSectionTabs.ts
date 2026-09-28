import type { TabItem } from "@/components/ui/TabBar";
import { PRO_BASKETBALL_LABEL } from "@/src/features/nba/proBasketballLeague";
import type { GameMode } from "@/src/mode/gameModeTypes";

export type SportsSectionTabKey = GameMode | "multiview";

type BuildSportsSectionTabItemsInput = {
  onSelectMode: (mode: GameMode) => void;
  onOpenMultiView: () => void;
};

export function buildSportsSectionTabItems({
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
      label: PRO_BASKETBALL_LABEL,
      onPress: () => onSelectMode("nba"),
    },
    {
      key: "multiview",
      label: "MultiView",
      onPress: onOpenMultiView,
    },
  ];
}
