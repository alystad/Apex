import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type HomeInsightsSectionsProps = {
  onSeeFullLeaderboard?: () => void;
  onViewMoreStreaks?: () => void;
  onViewMoreInjuries?: () => void;
};

// ---------------------------------------------------------------------------
// Placeholder data — layout-first. Swap for real wiring later.
// ---------------------------------------------------------------------------
const TOP_PERFORMERS = [
  { id: "tp1", name: "K. Thornton", jersey: "21", position: "G", team: "UCLA", rating: 9.1, stat: "27 pts · 5 reb · 6 ast", photo: "" },
  { id: "tp2", name: "D. Mensah", jersey: "4", position: "F", team: "DUKE", rating: 8.6, stat: "22 pts · 9 reb · 2 ast", photo: "" },
  { id: "tp3", name: "R. Ellison", jersey: "11", position: "G", team: "UNC", rating: 8.3, stat: "19 pts · 3 reb · 8 ast", photo: "" },
];

const RATING_JUMPS = [
  { id: "rj1", name: "K. Thornton", before: 6.9, after: 8.9, play: "Makes 26-foot three-point pullup", photo: "" },
  { id: "rj2", name: "A. Rivera", before: 5.1, after: 6.8, play: "And-one dunk in transition", photo: "" },
  { id: "rj3", name: "J. Okafor", before: 7.4, after: 6.1, play: "Turnover leads to fast-break layup", photo: "" },
  { id: "rj4", name: "M. Sun", before: 4.8, after: 6.2, play: "Chase-down block, outlet assist", photo: "" },
];

const UPSETS = [
  {
    id: "up1",
    awayAbbr: "SLU",
    homeAbbr: "GONZ",
    awayLogo: "",
    homeLogo: "",
    score: "71 - 68",
    context: "SLU won despite being given only 22% pre-game",
  },
  {
    id: "up2",
    awayAbbr: "IONA",
    homeAbbr: "UCONN",
    awayLogo: "",
    homeLogo: "",
    score: "63 - 61",
    context: "1-point final — UConn edged out at the buzzer",
  },
];

const STREAKS = [
  { id: "st1", name: "K. Thornton", team: "UCLA", streak: "3-game 20-point streak", photo: "" },
  { id: "st2", name: "D. Mensah", team: "DUKE", streak: "6-game double-double streak", photo: "" },
  { id: "st3", name: "R. Ellison", team: "UNC", streak: "4-game 8+ assist streak", photo: "" },
  { id: "st4", name: "A. Rivera", team: "KU", streak: "5-game 50%+ FG streak", photo: "" },
];

const INJURIES = [
  { id: "in1", name: "T. Whitaker", team: "MICH", status: "Out", reason: "Left ankle", photo: "" },
  { id: "in2", name: "C. Brooks", team: "IND", status: "Questionable", reason: "Knee soreness", photo: "" },
  { id: "in3", name: "L. Faust", team: "PUR", status: "Doubtful", reason: "Illness", photo: "" },
  { id: "in4", name: "M. Adebayo", team: "OSU", status: "Questionable", reason: "Hip", photo: "" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function Avatar({
  uri,
  name,
  size,
  styles,
}: {
  uri: string;
  name: string;
  size: number;
  styles: ReturnType<typeof createStyles>;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri: uri || FALLBACK_IMAGE_URI }}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={styles.avatarInitials}>{initials(name)}</Text>
    </View>
  );
}

function LinkButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress?: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.linkPressed : null]}
    >
      <Text style={styles.linkText}>{label}</Text>
      <Text style={styles.linkChevron}>›</Text>
    </Pressable>
  );
}

export default function HomeInsightsSections({
  onSeeFullLeaderboard,
  onViewMoreStreaks,
  onViewMoreInjuries,
}: HomeInsightsSectionsProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      {/* 2. Top Performers Today */}
      <Card style={styles.card}>
        <SectionHeader title="Top Performers Today" subtitle="Top 3 by rating across today's games" />
        <View style={styles.rows}>
          {TOP_PERFORMERS.map((player) => (
            <View key={player.id} style={styles.performerRow}>
              <Avatar uri={player.photo} name={player.name} size={40} styles={styles} />
              <View
                style={[
                  styles.ratingBadge,
                  { backgroundColor: getInGameRatingColor(player.rating) },
                ]}
              >
                <Text style={styles.ratingBadgeText}>{player.rating.toFixed(1)}</Text>
              </View>
              <View style={styles.performerCopy}>
                <Text style={styles.performerName} numberOfLines={1}>
                  {player.name} <Text style={styles.performerMetaInline}>#{player.jersey} · {player.position}</Text>
                </Text>
                <Text style={styles.statLine} numberOfLines={1}>
                  {player.stat}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <LinkButton label="See full leaderboard" onPress={onSeeFullLeaderboard} styles={styles} />
      </Card>

      {/* 3. Biggest Rating Jumps Today */}
      <Card style={styles.card}>
        <SectionHeader title="Biggest Rating Jumps Today" subtitle="Largest single-play rating swings" />
        <View style={styles.rows}>
          {RATING_JUMPS.map((jump) => {
            const up = jump.after >= jump.before;
            return (
              <View key={jump.id} style={styles.jumpRow}>
                <Avatar uri={jump.photo} name={jump.name} size={36} styles={styles} />
                <View style={styles.jumpCopy}>
                  <Text style={styles.performerName} numberOfLines={1}>
                    {jump.name}
                  </Text>
                  <Text style={styles.statLine} numberOfLines={1}>
                    {jump.play}
                  </Text>
                </View>
                <View style={styles.jumpDelta}>
                  <Text style={styles.jumpDeltaBefore}>{jump.before.toFixed(1)}</Text>
                  <Text
                    style={[
                      styles.jumpDeltaArrow,
                      { color: up ? theme.colors.success : theme.colors.danger },
                    ]}
                  >
                    {"→"}
                  </Text>
                  <Text
                    style={[
                      styles.jumpDeltaAfter,
                      { color: up ? theme.colors.success : theme.colors.danger },
                    ]}
                  >
                    {jump.after.toFixed(1)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {/* 4. Closest Games / Upsets */}
      <Card style={styles.card}>
        <SectionHeader title="Closest Games & Upsets" subtitle="Outcomes that beat the pre-game odds" />
        <View style={styles.rows}>
          {UPSETS.map((game) => (
            <View key={game.id} style={styles.upsetRow}>
              <View style={styles.upsetLogos}>
                <Avatar uri={game.awayLogo} name={game.awayAbbr} size={26} styles={styles} />
                <Avatar uri={game.homeLogo} name={game.homeAbbr} size={26} styles={styles} />
              </View>
              <View style={styles.upsetCopy}>
                <Text style={styles.performerName} numberOfLines={1}>
                  {game.awayAbbr} {game.score} {game.homeAbbr}
                </Text>
                <Text style={styles.statLine} numberOfLines={2}>
                  {game.context}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Card>

      {/* 5. Streaks */}
      <Card style={styles.card}>
        <SectionHeader title="Streaks" subtitle="Notable current player streaks" />
        <View style={styles.rows}>
          {STREAKS.slice(0, 3).map((streak) => (
            <View key={streak.id} style={styles.streakRow}>
              <Avatar uri={streak.photo} name={streak.name} size={36} styles={styles} />
              <View style={styles.jumpCopy}>
                <Text style={styles.performerName} numberOfLines={1}>
                  {streak.name} <Text style={styles.performerMetaInline}>· {streak.team}</Text>
                </Text>
                <Text style={styles.statLine} numberOfLines={1}>
                  {streak.streak}
                </Text>
              </View>
            </View>
          ))}
        </View>
        {STREAKS.length > 3 ? (
          <LinkButton label="View more" onPress={onViewMoreStreaks} styles={styles} />
        ) : null}
      </Card>

      {/* 6. Injuries */}
      <Card style={styles.card}>
        <SectionHeader title="Injuries" subtitle="Current player injury statuses" />
        <View style={styles.rows}>
          {INJURIES.slice(0, 3).map((injury) => (
            <View key={injury.id} style={styles.streakRow}>
              <Avatar uri={injury.photo} name={injury.name} size={36} styles={styles} />
              <View style={styles.jumpCopy}>
                <Text style={styles.performerName} numberOfLines={1}>
                  {injury.name} <Text style={styles.performerMetaInline}>· {injury.team}</Text>
                </Text>
                <Text style={styles.statLine} numberOfLines={1}>
                  {injury.reason}
                </Text>
              </View>
              <View
                style={[
                  styles.injuryStatus,
                  injury.status === "Out" ? styles.injuryStatusOut : styles.injuryStatusQuestionable,
                ]}
              >
                <Text
                  style={[
                    styles.injuryStatusText,
                    {
                      color:
                        injury.status === "Out"
                          ? theme.colors.danger
                          : theme.colors.warning,
                    },
                  ]}
                >
                  {injury.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
        {INJURIES.length > 3 ? (
          <LinkButton label="View more" onPress={onViewMoreInjuries} styles={styles} />
        ) : null}
      </Card>
    </View>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: {
      marginTop: theme.spacing[8],
      gap: theme.spacing[12],
    },
    card: {
      gap: theme.spacing[10],
    },
    rows: {
      gap: theme.spacing[8],
      marginTop: theme.spacing[8],
    },
    avatar: {
      backgroundColor: theme.colors.surfaceAlt,
    },
    avatarFallback: {
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitials: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: "800",
    },
    performerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    ratingBadge: {
      minWidth: 34,
      height: 20,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[6],
      alignItems: "center",
      justifyContent: "center",
    },
    ratingBadgeText: {
      color: "#0b1220",
      fontSize: 11,
      fontWeight: "800",
    },
    performerCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    performerName: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    performerMetaInline: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    statLine: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    jumpRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    jumpCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    jumpDelta: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      flexShrink: 0,
    },
    jumpDeltaBefore: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.textMuted,
      fontVariant: ["tabular-nums"],
    },
    jumpDeltaArrow: {
      fontSize: 14,
      fontWeight: "800",
    },
    jumpDeltaAfter: {
      fontSize: 16,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
    },
    upsetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    upsetLogos: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    upsetCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    streakRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    injuryStatus: {
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[2],
      flexShrink: 0,
    },
    injuryStatusOut: {
      borderColor: "rgba(255,142,152,0.4)",
      backgroundColor: "rgba(255,142,152,0.12)",
    },
    injuryStatusQuestionable: {
      borderColor: "rgba(225,197,122,0.4)",
      backgroundColor: "rgba(225,197,122,0.12)",
    },
    injuryStatusText: {
      fontSize: 11,
      fontWeight: "800",
    },
    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-end",
      gap: theme.spacing[4],
      marginTop: theme.spacing[4],
    },
    linkPressed: {
      opacity: theme.opacity.pressed,
    },
    linkText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
    },
    linkChevron: {
      fontSize: 16,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.accent,
    },
  });
}
