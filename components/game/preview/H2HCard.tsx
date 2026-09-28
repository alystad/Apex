import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";

import {
  normalizeImageUri,
  previewSectionTitleStyle,
  teamShortLabel,
  type PreviewTeam,
} from "./previewShared";

export type H2HMeeting = {
  gameId: string;
  dateLabel: string;
  awayScore: number;
  homeScore: number;
  awayWon: boolean;
};

export type H2HData = {
  /** Wins by the current away team across all matchups on record. */
  awayWins: number;
  /** Wins by the current home team across all matchups on record. */
  homeWins: number;
  /** Meetings on record, most recent first. */
  meetings: H2HMeeting[];
};

type H2HCardProps = {
  away: PreviewTeam | undefined;
  home: PreviewTeam | undefined;
  h2h: H2HData;
  onMeetingPress?: (gameId: string) => void;
};

export default function H2HCard({ away, home, h2h, onMeetingPress }: H2HCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const totalMeetings = h2h.awayWins + h2h.homeWins;
  const awayLeads = h2h.awayWins > h2h.homeWins;
  const homeLeads = h2h.homeWins > h2h.awayWins;
  const recentMeetings = h2h.meetings.slice(0, 6);

  return (
    <Card elevated>
      <Text style={styles.cardTitle}>Head to Head</Text>

      {totalMeetings === 0 ? (
        <Text style={styles.emptyText}>No head-to-head meetings on record.</Text>
      ) : (
        <>
          <Text style={styles.sectionLabel}>All-Time Series</Text>
          <View style={styles.seriesRow}>
            <View style={styles.seriesTeam}>
              <Image source={{ uri: normalizeImageUri(away?.logo) }} style={styles.teamLogo} />
              <Text style={styles.teamLabel} numberOfLines={1}>
                {teamShortLabel(away)}
              </Text>
            </View>
            <View style={styles.seriesScoreWrap}>
              <Text style={styles.seriesScore}>
                <Text style={awayLeads ? styles.seriesLead : styles.seriesTrail}>
                  {h2h.awayWins}
                </Text>
                <Text style={styles.seriesDash}> — </Text>
                <Text style={homeLeads ? styles.seriesLead : styles.seriesTrail}>
                  {h2h.homeWins}
                </Text>
              </Text>
              <Text style={styles.seriesMeta}>
                {totalMeetings} {totalMeetings === 1 ? "meeting" : "meetings"} on record
              </Text>
            </View>
            <View style={styles.seriesTeamRight}>
              <Text style={styles.teamLabel} numberOfLines={1}>
                {teamShortLabel(home)}
              </Text>
              <Image source={{ uri: normalizeImageUri(home?.logo) }} style={styles.teamLogo} />
            </View>
          </View>

          <Text style={styles.sectionLabel}>Recent Meetings</Text>
          <View style={styles.meetingsList}>
            {recentMeetings.map((meeting) => {
              const homeWon = !meeting.awayWon;
              return (
                <Pressable
                  key={meeting.gameId}
                  onPress={onMeetingPress ? () => onMeetingPress(meeting.gameId) : undefined}
                  disabled={!onMeetingPress}
                  style={({ pressed }) => [
                    styles.meetingCard,
                    onMeetingPress && pressed ? styles.meetingCardPressed : null,
                  ]}
                >
                  <View style={styles.meetingCardHead}>
                    <View style={styles.finalBadge}>
                      <Text style={styles.finalBadgeText}>Final</Text>
                    </View>
                    <Text style={styles.meetingDate}>{meeting.dateLabel}</Text>
                  </View>
                  <View style={styles.matchupRow}>
                    <View style={[styles.teamSlot, styles.teamSlotHome]}>
                      <Text
                        style={[
                          styles.matchTeamName,
                          homeWon ? null : styles.matchTeamNameLose,
                        ]}
                        numberOfLines={1}
                      >
                        {teamShortLabel(home)}
                      </Text>
                      <Image
                        source={{ uri: normalizeImageUri(home?.logo) }}
                        style={styles.matchLogo}
                      />
                    </View>
                    <Text style={styles.matchScore}>
                      {meeting.homeScore} — {meeting.awayScore}
                    </Text>
                    <View style={[styles.teamSlot, styles.teamSlotAway]}>
                      <Image
                        source={{ uri: normalizeImageUri(away?.logo) }}
                        style={styles.matchLogo}
                      />
                      <Text
                        style={[
                          styles.matchTeamName,
                          meeting.awayWon ? null : styles.matchTeamNameLose,
                        ]}
                        numberOfLines={1}
                      >
                        {teamShortLabel(away)}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Card>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    cardTitle: previewSectionTitleStyle(theme),
    emptyText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: theme.spacing[12],
    },
    sectionLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: theme.spacing[14],
    },
    seriesRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: theme.spacing[8],
      gap: theme.spacing[8],
    },
    seriesTeam: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    seriesTeamRight: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: theme.spacing[6],
    },
    seriesScoreWrap: {
      alignItems: "center",
      gap: theme.spacing[2],
    },
    seriesScore: {
      ...theme.type.title,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "800",
    },
    seriesLead: {
      color: theme.colors.textPrimary,
    },
    seriesTrail: {
      color: theme.colors.textMuted,
    },
    seriesDash: {
      color: theme.colors.textMuted,
    },
    seriesMeta: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
    },
    teamLogo: {
      width: 24,
      height: 24,
      borderRadius: theme.radius.pill,
    },
    teamLabel: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
    },
    meetingsList: {
      marginTop: theme.spacing[8],
      gap: theme.spacing[8],
    },
    meetingCard: {
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      gap: theme.spacing[6],
    },
    meetingCardPressed: {
      opacity: 0.7,
    },
    meetingCardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    finalBadge: {
      paddingHorizontal: theme.spacing[6],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    finalBadgeText: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      fontWeight: "700",
    },
    meetingDate: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
    },
    matchupRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    teamSlot: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      minWidth: 0,
    },
    teamSlotHome: {
      justifyContent: "flex-end",
    },
    teamSlotAway: {
      justifyContent: "flex-start",
    },
    matchLogo: {
      width: 18,
      height: 18,
      borderRadius: theme.radius.pill,
      flexShrink: 0,
    },
    matchTeamName: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    matchTeamNameLose: {
      color: theme.colors.textMuted,
    },
    matchScore: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
      flexShrink: 0,
    },
  });
}
