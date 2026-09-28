import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";
import { tokens } from "@/src/ui/tokens";

export type DividerProps = {
  inset?: number;
  style?: StyleProp<ViewStyle>;
};

export default function Divider({ inset = 0, style }: DividerProps) {
  const { tokens: theme } = useAppTheme();

  return (
    <View
      style={[
        styles.base,
        { marginHorizontal: inset, backgroundColor: theme.colors.borderSoft },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.borderSoft,
  },
});
