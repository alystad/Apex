import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";

type AiNewsCardProps = {
  /** One-line summary of the overall game (not a single stat). */
  headline: string;
  onPress?: () => void;
};

export default function AiNewsCard({ headline, onPress }: AiNewsCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Card elevated>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.pressable, pressed ? styles.pressablePressed : null]}
      >
        <View style={styles.tag}>
          <Text style={styles.tagText}>Apex Article</Text>
        </View>
        <Text style={styles.headline}>{headline}</Text>
      </Pressable>
    </Card>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    pressable: {
      gap: theme.spacing[8],
    },
    pressablePressed: {
      opacity: theme.opacity.pressed,
    },
    tag: {
      alignSelf: "flex-start",
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.accentStrong,
      backgroundColor: "rgba(255,255,255,0.08)",
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
    },
    tagText: {
      ...theme.type.micro,
      color: theme.colors.textPrimary,
    },
    headline: {
      ...theme.type.subtitle,
      color: theme.colors.textPrimary,
    },
  });
}
