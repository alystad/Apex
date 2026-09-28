import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import TabBar, { type TabItem } from "@/components/ui/TabBar";
import type { ConferenceOption } from "@/src/conferences/conferenceFilterTypes";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";

type ConferenceFilterBarProps = {
  options: ConferenceOption[];
  selectedKey: string;
  onSelect: (option: ConferenceOption) => void;
};

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: -theme.spacing[2],
    },
  });
}

export default function ConferenceFilterBar({
  options,
  selectedKey,
  onSelect,
}: ConferenceFilterBarProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const items = useMemo<TabItem[]>(
    () =>
      options.map((option) => ({
        key: option.key,
        label: option.label,
        onPress: () => onSelect(option),
      })),
    [onSelect, options],
  );

  return (
    <View style={styles.wrap}>
      <TabBar items={items} activeKey={selectedKey} variant="flat" />
    </View>
  );
}

