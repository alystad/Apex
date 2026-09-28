import { StyleSheet, View } from "react-native";

import TabBar, { type TabItem } from "@/components/ui/TabBar";
import { useAppTheme } from "@/src/theme/useAppTheme";

export type PlayerProfileTabKey =
  | "overview"
  | "game-log"
  | "stats"
  | "ratings"
  | "splits"
  | "bio"
  | "news"
  | "team";

type PlayerProfileTabBarProps = {
  items: TabItem[];
  activeKey: PlayerProfileTabKey;
};

export default function PlayerProfileTabBar({
  items,
  activeKey,
}: PlayerProfileTabBarProps) {
  const { tokens: theme } = useAppTheme();
  const styles = StyleSheet.create({
    wrap: {
      backgroundColor: theme.colors.bg,
      paddingBottom: theme.spacing[8],
      borderBottomWidth: theme.borderWidth.normal,
      borderBottomColor: theme.colors.border,
    },
  });

  return (
    <View style={styles.wrap}>
      <TabBar items={items} activeKey={activeKey} variant="flat" textPreset="largeAccent" />
    </View>
  );
}
