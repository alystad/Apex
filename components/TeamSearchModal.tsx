import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";
import { useLiveGame } from "@/hooks/useLiveGame";
import { searchTeams, type TeamSearchResult } from "@/src/features/basketball/teamApi";
import { buildPlayerProfileHref } from "@/src/features/basketball/playerNavigation";
import { PRO_BASKETBALL_LABEL } from "@/src/features/nba/proBasketballLeague";
import { useGameModeState } from "@/src/mode/GameModeContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type TeamSearchModalProps = {
  visible: boolean;
  onClose: () => void;
};

export default function TeamSearchModal({ visible, onClose }: TeamSearchModalProps) {
  const router = useRouter();
  const { mode } = useGameModeState();
  const { data: liveData, gameId } = useLiveGame();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = useMemo(() => query.trim(), [query]);
  const title =
    mode === "nba"
      ? `${PRO_BASKETBALL_LABEL} Team Search`
      : mode === "baseball"
        ? "College Baseball Team Search"
        : "Team Search";
  const placeholder =
    mode === "nba"
      ? `Search ${PRO_BASKETBALL_LABEL} teams`
      : mode === "baseball"
        ? "Search college baseball teams"
        : "Search teams or players";
  const players = useMemo(
    () => Object.values(liveData?.playersByTeam ?? {}).flat(),
    [liveData?.playersByTeam],
  );
  const teamsById = useMemo(() => {
    const map = new Map<string, LiveGameTeam>();
    (liveData?.teams ?? []).forEach((team) => {
      if (team.id) {
        map.set(team.id, team);
      }
    });
    return map;
  }, [liveData?.teams]);
  const playerResults = useMemo(() => {
    const normalized = normalizedQuery.toLowerCase();
    if (!normalized) {
      return [];
    }

    return players
      .filter((player) => player.name.toLowerCase().includes(normalized))
      .sort((left, right) => {
        const leftRating = left.seasonRating10 ?? left.inGameRating10 ?? -1;
        const rightRating = right.seasonRating10 ?? right.inGameRating10 ?? -1;
        if (leftRating !== rightRating) {
          return rightRating - leftRating;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }, [normalizedQuery, players]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (!normalizedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const timeoutId = setTimeout(() => {
      void searchTeams(mode, normalizedQuery)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not search teams right now.");
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [mode, normalizedQuery, visible]);

  const onSelectTeam = (teamId: string) => {
    onClose();
    router.push({ pathname: "/team/[teamId]", params: { teamId, mode } } as never);
  };
  const onSelectPlayer = (player: LiveGamePlayer) => {
    const team = teamsById.get(player.teamId) ?? null;
    onClose();
    router.push(
      buildPlayerProfileHref({
        player,
        mode,
        gameId,
        team,
      }) as never,
    );
  };

  const renderEmpty = () => {
    if (!normalizedQuery) {
      return <Text style={styles.emptyText}>Search for a player or team</Text>;
    }
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.colors.accentStrong} />
          <Text style={styles.emptyText}>Searching...</Text>
        </View>
      );
    }
    if (error) {
      return <Text style={styles.errorText}>Could not search teams right now.</Text>;
    }
    return <Text style={styles.emptyText}>No players or teams found</Text>;
  };
  const hasResults = playerResults.length > 0 || results.length > 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.backdrop}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close search"
                onPress={onClose}
                style={styles.closeButton}
              >
                <FontAwesome name="close" size={18} color={theme.colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.searchBar}>
              <FontAwesome name="search" size={16} color={theme.colors.textMuted} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.textMuted}
                style={styles.input}
              />
            </View>

            {hasResults ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              >
                {playerResults.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Players</Text>
                    {playerResults.map((player) => (
                      <PlayerSearchRow
                        key={player.id}
                        player={player}
                        team={teamsById.get(player.teamId) ?? null}
                        onPress={() => onSelectPlayer(player)}
                      />
                    ))}
                  </View>
                ) : null}

                {results.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Teams</Text>
                    {results.map((item) => (
                      <Pressable
                        key={item.teamId}
                        onPress={() => onSelectTeam(item.teamId)}
                        style={({ pressed }) => [
                          styles.resultRow,
                          pressed ? styles.pressed : null,
                        ]}
                      >
                        <Image source={{ uri: item.logo || FALLBACK_IMAGE_URI }} style={styles.logo} />
                        <View style={styles.resultCopy}>
                          <Text style={styles.resultName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.resultMeta} numberOfLines={1}>
                            {[item.shortName, item.abbreviation, item.conference].filter(Boolean).join(" | ")}
                          </Text>
                        </View>
                        <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            ) : (
              <View style={styles.emptyContainer}>{renderEmpty()}</View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function PlayerSearchRow({
  onPress,
  player,
  team,
}: {
  onPress: () => void;
  player: LiveGamePlayer;
  team: LiveGameTeam | null;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const rating = player.seasonRating10 ?? player.inGameRating10;
  const teamName = team?.displayName || team?.shortDisplayName || "Team";
  const meta = [teamName, player.position].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, pressed ? styles.pressed : null]}
    >
      <Image source={{ uri: player.headshot || FALLBACK_IMAGE_URI }} style={styles.playerPhoto} />
      <View style={styles.resultCopy}>
        <Text style={styles.resultName} numberOfLines={1}>
          {player.name}
        </Text>
        <Text style={styles.resultMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={[styles.ratingPill, { backgroundColor: getInGameRatingColor(rating) }]}>
        <Text style={styles.ratingPillText}>
          {typeof rating === "number" && Number.isFinite(rating) ? rating.toFixed(1) : "-"}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing[16],
    paddingTop: theme.spacing[32] + theme.spacing[16],
    paddingBottom: theme.spacing[12],
    gap: theme.spacing[12],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.pill,
    borderWidth: theme.borderWidth.normal,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    minHeight: 48,
    borderRadius: theme.radius.lg,
    borderWidth: theme.borderWidth.normal,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing[14],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[10],
  },
  input: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes.body,
    lineHeight: 20,
    fontWeight: "600",
    paddingVertical: 0,
  },
  listContent: {
    gap: theme.spacing[16],
    paddingBottom: theme.spacing[24],
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[20],
  },
  centerState: {
    alignItems: "center",
    gap: theme.spacing[10],
  },
  emptyText: {
    fontSize: theme.fontSizes.body,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  errorText: {
    fontSize: theme.fontSizes.body,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.danger,
    textAlign: "center",
  },
  section: {
    gap: theme.spacing[8],
  },
  sectionLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    paddingHorizontal: theme.spacing[4],
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[12],
    borderRadius: theme.radius.lg,
    borderWidth: theme.borderWidth.normal,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[10],
  },
  pressed: {
    opacity: theme.opacity.pressed,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceAlt,
  },
  playerPhoto: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.surfaceAlt,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  resultName: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes.body,
    lineHeight: 20,
    fontWeight: "700",
  },
  resultMeta: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  ratingPill: {
    minWidth: 42,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  ratingPillText: {
    color: theme.colors.bg,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
  },
  });
}
