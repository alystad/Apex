import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type ListItemShellProps = {
  children: ReactNode;
  onPress?: () => void;
};

export default function ListItemShell({ children, onPress }: ListItemShellProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[14],
          paddingVertical: theme.spacing[12],
        },
        pressed: {
          opacity: theme.opacity.pressed,
        },
      }),
    [theme],
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.base, pressed ? styles.pressed : null]}
      disabled={!onPress}
    >
      <View>{children}</View>
    </Pressable>
  );
}
