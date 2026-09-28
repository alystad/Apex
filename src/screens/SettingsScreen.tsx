import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSettings } from "@/src/settings/SettingsContext";
import { useProfile } from "@/src/profile/ProfileContext";
import type {
  CourtStyle,
  InGameSectionKey,
  InGameTab,
  ThemeMode,
} from "@/src/settings/settingsTypes";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getResolvedDefaultInGameTab, getVisibleInGameTabItems } from "@/src/ui/inGameTabs";

type SegmentedOption<T extends string> = {
  key: T;
  label: string;
  detail?: string;
};

const THEME_OPTIONS: SegmentedOption<ThemeMode>[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "team", label: "Team Colors" },
];

const COURT_STYLE_OPTIONS: SegmentedOption<CourtStyle>[] = [
  { key: "detailed", label: "Detailed" },
  { key: "minimal", label: "Minimal" },
];

const DEFAULT_TAB_OPTIONS: SegmentedOption<InGameTab>[] = [
  { key: "court", label: "Court", detail: "Open to the live court view" },
  { key: "stats", label: "Stats", detail: "Open to the side-by-side team stats tab" },
  {
    key: "commentary",
    label: "Commentary",
    detail: "Open to the play-by-play tab when it is enabled",
  },
];

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    content: {
      paddingHorizontal: theme.spacing[16],
      paddingTop: theme.spacing[10],
      paddingBottom: theme.spacing[24],
      gap: theme.spacing[12],
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.spacing[4],
    },
    closeButton: {
      minHeight: 38,
      paddingHorizontal: theme.spacing[12],
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    closeText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    eyebrow: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: theme.colors.accent,
      marginBottom: theme.spacing[6],
    },
    title: {
      fontSize: 32,
      lineHeight: 36,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
      color: theme.colors.textSecondary,
      marginTop: theme.spacing[6],
      maxWidth: 320,
    },
    card: {
      borderRadius: 22,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: theme.spacing[16],
      paddingVertical: theme.spacing[16],
      gap: theme.spacing[14],
    },
    cardHeader: {
      gap: theme.spacing[4],
    },
    cardTitle: {
      fontSize: 20,
      lineHeight: 24,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    cardSubtitle: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    segmentedWrap: {
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      padding: theme.spacing[4],
      gap: theme.spacing[4],
    },
    segmentedRow: {
      flexDirection: "row",
      gap: theme.spacing[6],
    },
    segmentedOption: {
      flex: 1,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      alignItems: "center",
      justifyContent: "center",
      borderWidth: theme.borderWidth.normal,
      borderColor: "transparent",
      backgroundColor: "transparent",
    },
    segmentedOptionActive: {
      backgroundColor: "transparent",
      borderColor: "transparent",
    },
    segmentedLabel: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: "rgba(255,255,255,0.6)",
    },
    segmentedLabelActive: {
      color: "#FFFFFF",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
      paddingVertical: theme.spacing[2],
    },
    rowCopy: {
      flex: 1,
      gap: theme.spacing[2],
    },
    rowLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    rowDetail: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    divider: {
      height: theme.borderWidth.hairline,
      backgroundColor: theme.colors.borderSoft,
    },
    pickerButton: {
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[12],
      gap: theme.spacing[4],
    },
    pickerLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    pickerValue: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    pickerDetail: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    hintText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.warning,
    },
    resetButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
    },
    resetButtonText: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(5, 10, 18, 0.7)",
      justifyContent: "flex-end",
      padding: theme.spacing[16],
    },
    modalSheet: {
      borderRadius: 24,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: theme.spacing[16],
      paddingTop: theme.spacing[16],
      paddingBottom: theme.spacing[12],
      gap: theme.spacing[10],
    },
    modalTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    modalOption: {
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[14],
      gap: theme.spacing[4],
    },
    modalOptionActive: {
      borderColor: theme.colors.accentStrong,
      backgroundColor: theme.colors.chip,
    },
    modalOptionLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    modalOptionDetail: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    modalClose: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing[10],
    },
    modalCloseText: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
  });
}

function SegmentedControl<T extends string>({
  theme,
  options,
  value,
  onChange,
}: {
  theme: ThemeTokens;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.segmentedWrap}>
      <View style={styles.segmentedRow}>
        {options.map((option) => {
          const active = option.key === value;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key)}
              style={[
                styles.segmentedOption,
                active ? styles.segmentedOptionActive : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentedLabel,
                  active ? styles.segmentedLabelActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    state,
    setThemeMode,
    setCourtStyle,
    toggleTeamColorsOnCourt,
    toggleInGameSection,
    setDefaultInGameTab,
    resetToDefaults,
  } = useSettings();
  const { state: profileState } = useProfile();
  const [isDefaultTabModalOpen, setIsDefaultTabModalOpen] = useState(false);
  const hasFavoriteTeamTheme = Boolean(profileState.profile.favoriteTeamTheme?.teamId);
  const visibleInGameTabs = useMemo(() => getVisibleInGameTabItems(state), [state]);

  const defaultTabLabel = useMemo(
    () =>
      DEFAULT_TAB_OPTIONS.find((option) => option.key === state.inGame.defaultTab)
        ?.label ?? "Court",
    [state.inGame.defaultTab],
  );
  const defaultTabUnavailable = useMemo(() => {
    const resolvedDefault = getResolvedDefaultInGameTab(state);
    if (state.inGame.defaultTab === "court") {
      return resolvedDefault.key !== "live";
    }
    if (state.inGame.defaultTab === "stats") {
      return resolvedDefault.key !== "team-stats";
    }
    return resolvedDefault.key !== "playbyplay";
  }, [state]);

  const onReset = () => {
    Alert.alert(
      "Reset settings?",
      "This will restore the default theme, court, and in-game layout options.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => resetToDefaults(),
        },
      ],
    );
  };

  const renderSectionToggle = (
    key: InGameSectionKey,
    label: string,
    detail: string,
  ) => (
    <View key={key}>
      <View style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowDetail}>{detail}</Text>
        </View>
        <Switch
          value={state.inGame.sections[key]}
          onValueChange={() => toggleInGameSection(key)}
          trackColor={{
            false: theme.colors.borderSoft,
            true: theme.colors.accentStrong,
          }}
          thumbColor={theme.colors.surface}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>Preferences</Text>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>
              Tune the app's look, the court presentation, and what shows up in
              your live game experience.
            </Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.closeButton}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Appearance</Text>
            <Text style={styles.cardSubtitle}>
              Keep the app neutral or push more visual identity onto the court.
            </Text>
          </View>

          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>Theme</Text>
            <Text style={styles.rowDetail}>
              Follow the device, force a mode, or use your favorited team's colors.
            </Text>
          </View>
          <SegmentedControl
            theme={theme}
            options={THEME_OPTIONS}
            value={state.themeMode}
            onChange={setThemeMode}
          />
          {state.themeMode === "team" ? (
            <Text style={styles.hintText}>
              {hasFavoriteTeamTheme
                ? "Cards use your favorited team's primary color and the app background uses its secondary color."
                : "Favorite a team from its team profile to enable team colors."}
            </Text>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>Court style</Text>
            <Text style={styles.rowDetail}>
              Detailed keeps the full visual treatment. Minimal tones it down.
            </Text>
          </View>
          <SegmentedControl
            theme={theme}
            options={COURT_STYLE_OPTIONS}
            value={state.courtStyle}
            onChange={setCourtStyle}
          />

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>Use team colors on court</Text>
              <Text style={styles.rowDetail}>
                Tint the court presentation with the matchup's palette.
              </Text>
            </View>
            <Switch
              value={state.useTeamColorsOnCourt}
              onValueChange={toggleTeamColorsOnCourt}
              trackColor={{
                false: theme.colors.borderSoft,
                true: theme.colors.accentStrong,
              }}
              thumbColor={theme.colors.surface}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>In-Game Layout</Text>
            <Text style={styles.cardSubtitle}>
              Choose the first tab you land on and tune which premium modules
              appear in the live center.
            </Text>
          </View>

          <Pressable
            onPress={() => setIsDefaultTabModalOpen(true)}
            style={styles.pickerButton}
          >
            <Text style={styles.pickerLabel}>Default opening tab</Text>
            <Text style={styles.pickerValue}>{defaultTabLabel}</Text>
            <Text style={styles.pickerDetail}>
              If the chosen tab is unavailable, the app falls back automatically.
            </Text>
          </Pressable>

          {defaultTabUnavailable ? (
            <Text style={styles.hintText}>
              Your current Edit Screen tab layout hides that opening tab, so games
              will open on the first visible in-game tab instead.
            </Text>
          ) : null}

          <View style={styles.divider} />

          {renderSectionToggle(
            "momentum",
            "Momentum",
            "Show the win probability and momentum breakdown card.",
          )}
          <View style={styles.divider} />
          {renderSectionToggle(
            "liveImpact",
            "Live Impact",
            "Show the latest impact play and rating swing summary.",
          )}
          <View style={styles.divider} />
          {renderSectionToggle(
            "betting",
            "Betting",
            "Show live market context inside the Insights tab.",
          )}
          <View style={styles.divider} />
          <Text style={styles.rowDetail}>
            Reorder and hide in-game tabs from the live-game 3-dot menu with
            Edit Screen. {visibleInGameTabs.length} tab{visibleInGameTabs.length === 1 ? "" : "s"} are currently visible.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Advanced</Text>
            <Text style={styles.cardSubtitle}>
              Reset everything back to the default app profile.
            </Text>
          </View>
          <Pressable onPress={onReset} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Reset to Defaults</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={isDefaultTabModalOpen}
        onRequestClose={() => setIsDefaultTabModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsDefaultTabModalOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Default opening tab</Text>
            {DEFAULT_TAB_OPTIONS.map((option) => {
              const active = option.key === state.inGame.defaultTab;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    setDefaultInGameTab(option.key);
                    setIsDefaultTabModalOpen(false);
                  }}
                  style={[
                    styles.modalOption,
                    active ? styles.modalOptionActive : null,
                  ]}
                >
                  <Text style={styles.modalOptionLabel}>{option.label}</Text>
                  {option.detail ? (
                    <Text style={styles.modalOptionDetail}>{option.detail}</Text>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setIsDefaultTabModalOpen(false)}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
