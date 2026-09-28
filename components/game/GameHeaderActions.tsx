import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Card from "@/components/ui/Card";
import type { LiveGameSyncCalibrationPlay } from "@/hooks/useLiveGame";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";

type GameHeaderActionsProps = {
  visible: boolean;
  isInMultiView: boolean;
  isFavorited: boolean;
  liveDataDelaySeconds: number;
  syncCalibrationPlays: LiveGameSyncCalibrationPlay[];
  onLiveDataDelayChange: (seconds: number) => void;
  onEditScreen: () => void;
  onAddToMultiView: () => void;
  onRemoveFromMultiView: () => void;
  onGoToMultiView: () => void;
  onToggleFavorite: () => void;
  onClose: () => void;
};

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.58)",
      justifyContent: "flex-end",
    },
    sheetWrap: {
      paddingHorizontal: theme.spacing[16],
      width: "100%",
    },
    sheet: {
      width: "100%",
      maxWidth: 560,
      borderRadius: theme.radius.xl,
      alignSelf: "center",
      overflow: "hidden",
    },
    actionRow: {
      minHeight: 58,
      paddingHorizontal: theme.spacing[18],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    actionText: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    actionHint: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },
    delayRow: {
      minHeight: 72,
      paddingHorizontal: theme.spacing[18],
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[10],
    },
    delayTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
    },
    delayTitleWrap: {
      flex: 1,
      minWidth: 0,
    },
    delaySubtitle: {
      marginTop: 2,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    delayControls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[8],
    },
    delayButton: {
      width: 42,
      height: 34,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.glass,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
    },
    delayButtonText: {
      fontSize: 15,
      lineHeight: 18,
      fontWeight: "900",
      color: theme.colors.textPrimary,
    },
    delayValue: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
    calibratorWrap: {
      gap: theme.spacing[8],
    },
    calibratorEmpty: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    calibratorPlay: {
      minHeight: 48,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      backgroundColor: theme.colors.glass,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      gap: 3,
    },
    calibratorPlayText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    calibratorPlayMeta: {
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },
    divider: {
      height: theme.borderWidth.hairline,
      backgroundColor: theme.colors.borderSoft,
    },
    cancelWrap: {
      marginTop: theme.spacing[12],
      marginBottom: theme.spacing[4],
    },
    cancelCard: {
      borderRadius: theme.radius.xl,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 54,
    },
    cancelText: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textSecondary,
    },
  });
}

export default function GameHeaderActions({
  visible,
  isInMultiView,
  isFavorited,
  liveDataDelaySeconds,
  syncCalibrationPlays,
  onLiveDataDelayChange,
  onEditScreen,
  onAddToMultiView,
  onRemoveFromMultiView,
  onGoToMultiView,
  onToggleFavorite,
  onClose,
}: GameHeaderActionsProps) {
  const insets = useSafeAreaInsets();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [isCalibratorOpen, setIsCalibratorOpen] = useState(false);
  const delayLabel =
    liveDataDelaySeconds <= 0 ? "Off" : `${liveDataDelaySeconds}s`;
  const setDelay = (seconds: number) => {
    onLiveDataDelayChange(Math.max(0, Math.min(120, Math.round(seconds))));
  };
  const calibrateFromPlay = (play: LiveGameSyncCalibrationPlay) => {
    const firstSeenAt = new Date(play.firstSeenAtIso).getTime();
    if (!Number.isFinite(firstSeenAt)) {
      return;
    }
    setDelay((Date.now() - firstSeenAt) / 1000);
    setIsCalibratorOpen(false);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheetWrap,
            { paddingBottom: Math.max(insets.bottom, theme.spacing[12]) },
          ]}
          pointerEvents="box-none"
        >
          <Pressable onPress={() => {}}>
            <Card style={styles.sheet} padded={false} elevated>
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  onClose();
                  onToggleFavorite();
                }}
              >
                <Text style={styles.actionText}>
                  {isFavorited ? "Following" : "Follow"}
                </Text>
                <Text style={styles.actionHint}>
                  {isFavorited ? "Saved" : "Save"}
                </Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  onClose();
                  onEditScreen();
                }}
              >
                <Text style={styles.actionText}>Edit Screen</Text>
                <Text style={styles.actionHint}>Layout</Text>
              </Pressable>
              <View style={styles.divider} />
              <View style={styles.delayRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open sync delay calibrator"
                  style={styles.delayTopRow}
                  onPress={() => setIsCalibratorOpen((current) => !current)}
                >
                  <View style={styles.delayTitleWrap}>
                    <Text style={styles.actionText}>Sync Delay</Text>
                    <Text style={styles.delaySubtitle}>
                      Tap, then pick the play when it happens on your stream.
                    </Text>
                  </View>
                  <Text style={styles.actionHint}>Data</Text>
                </Pressable>
                <View style={styles.delayControls}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease sync delay"
                    style={styles.delayButton}
                    onPress={() => setDelay(liveDataDelaySeconds - 5)}
                  >
                    <Text style={styles.delayButtonText}>-5</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Turn sync delay off"
                    style={styles.delayButton}
                    onPress={() => setDelay(0)}
                  >
                    <Text style={styles.delayButtonText}>0</Text>
                  </Pressable>
                  <Text style={styles.delayValue}>{delayLabel}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase sync delay"
                    style={styles.delayButton}
                    onPress={() => setDelay(liveDataDelaySeconds + 5)}
                  >
                    <Text style={styles.delayButtonText}>+5</Text>
                  </Pressable>
                </View>
                {isCalibratorOpen ? (
                  <View style={styles.calibratorWrap}>
                    {syncCalibrationPlays.length > 0 ? (
                      syncCalibrationPlays.map((play) => (
                        <Pressable
                          key={play.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Calibrate sync delay from ${play.text}`}
                          style={styles.calibratorPlay}
                          onPress={() => calibrateFromPlay(play)}
                        >
                          <Text style={styles.calibratorPlayText} numberOfLines={2}>
                            {play.text}
                          </Text>
                          <Text style={styles.calibratorPlayMeta} numberOfLines={1}>
                            {play.period || "Game"} {play.clock || "-"} | {play.awayScore || "-"}-
                            {play.homeScore || "-"}
                          </Text>
                        </Pressable>
                      ))
                    ) : (
                      <Text style={styles.calibratorEmpty}>
                        Recent plays will appear here once live data arrives.
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
              <View style={styles.divider} />
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  onClose();
                  if (isInMultiView) {
                    onRemoveFromMultiView();
                    return;
                  }
                  onAddToMultiView();
                }}
              >
                <Text style={styles.actionText}>
                  {isInMultiView ? "Remove from MultiView" : "Add to MultiView"}
                </Text>
                <Text style={styles.actionHint}>{isInMultiView ? "Added" : "New"}</Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  onClose();
                  onGoToMultiView();
                }}
              >
                <Text style={styles.actionText}>Go to MultiView</Text>
                <Text style={styles.actionHint}>Open</Text>
              </Pressable>
            </Card>
          </Pressable>

          <Pressable
            style={styles.cancelWrap}
            onPress={onClose}
          >
            <Card style={styles.cancelCard} elevated>
              <Text style={styles.cancelText}>Cancel</Text>
            </Card>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
