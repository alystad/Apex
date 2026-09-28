import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { RecapMoment } from "@/src/features/recap/recapMoments";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { requestPlayHighlight } from "@/src/ui/inGamePlayHighlight";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

export type BiggestMomentsCardProps = {
  moments: RecapMoment[];
  /** "Biggest Moments" when final, "Biggest Moments So Far" while live. */
  title?: string;
};

/**
 * Tappable list of a game's defining moments, shared by the Recap and Live
 * states of the story tab. Tapping a row hands the target play to the Plays
 * tab via `requestPlayHighlight` and switches tabs — the same handoff the
 * Court tab's "See all" uses, so the scroll-to + flash-highlight behavior is
 * the existing one rather than a second implementation.
 */
export default function BiggestMomentsCard({
  moments,
  title = "Biggest Moments",
}: BiggestMomentsCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { goToTab } = useInGameTabNavigation();

  const handlePress = useCallback(
    (moment: RecapMoment) => {
      if (moment.playId) {
        requestPlayHighlight(moment.playId);
      }
      goToTab("playbyplay");
    },
    [goToTab],
  );

  if (moments.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title={title} />
      <View style={styles.rowList}>
        {moments.map((moment) => (
          <Pressable
            key={`${moment.kind}-${moment.playId ?? moment.label}`}
            accessibilityRole="button"
            accessibilityLabel={`${moment.label}. ${moment.detail}. Open in plays.`}
            onPress={() => handlePress(moment)}
            style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}
          >
            <View style={styles.bullet} />
            <View style={styles.listBody}>
              <Text style={styles.listTitle} numberOfLines={1}>
                {moment.label}
              </Text>
              {moment.detail ? (
                <Text style={styles.listDetail} numberOfLines={1}>
                  {moment.detail}
                </Text>
              ) : null}
            </View>
            <FontAwesome name="chevron-right" size={11} color={theme.colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    rowList: {
      marginTop: theme.spacing[10],
      gap: theme.spacing[4],
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      paddingVertical: theme.spacing[8],
    },
    pressed: {
      opacity: 0.85,
    },
    bullet: {
      width: 6,
      height: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accent,
    },
    listBody: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    listTitle: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    listDetail: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
  });
}
