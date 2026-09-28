import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

type CalendarModalProps = {
  visible: boolean;
  /** Currently selected date, yyyy-MM-dd. */
  selectedDateKey: string;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
};

function parseDateKey(key: string): Date {
  const parsed = parse(key, "yyyy-MM-dd", new Date());
  return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : startOfDay(parsed);
}

export default function CalendarModal({
  visible,
  selectedDateKey,
  onSelect,
  onClose,
}: CalendarModalProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const selectedDate = useMemo(() => parseDateKey(selectedDateKey), [selectedDateKey]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate));

  // When the calendar (re)opens, snap the visible month back to the selected date.
  useEffect(() => {
    if (visible) {
      setViewMonth(startOfMonth(parseDateKey(selectedDateKey)));
    }
  }, [selectedDateKey, visible]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth));
    const gridEnd = endOfWeek(endOfMonth(viewMonth));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <Card style={styles.card} padded={false} elevated>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                hitSlop={8}
                onPress={() => setViewMonth((month) => addMonths(month, -1))}
                style={styles.navBtn}
              >
                <FontAwesome name="chevron-left" size={16} color={theme.colors.textSecondary} />
              </Pressable>
              <Text style={styles.title}>{format(viewMonth, "MMMM yyyy")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                hitSlop={8}
                onPress={() => setViewMonth((month) => addMonths(month, 1))}
                style={styles.navBtn}
              >
                <FontAwesome name="chevron-right" size={16} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAY_LABELS.map((label, index) => (
                <Text key={`${label}-${index}`} style={styles.weekLabel}>
                  {label}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {days.map((day) => {
                const inMonth = isSameMonth(day, viewMonth);
                const isSelected = isSameDay(day, selectedDate);
                const isToday = isSameDay(day, today);
                return (
                  <Pressable
                    key={day.toISOString()}
                    accessibilityRole="button"
                    onPress={() => onSelect(format(day, "yyyy-MM-dd"))}
                    style={styles.dayCell}
                  >
                    <View
                      style={[
                        styles.dayInner,
                        isSelected
                          ? styles.daySelected
                          : isToday
                            ? styles.dayToday
                            : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          !inMonth ? styles.dayTextMuted : null,
                          isSelected ? styles.dayTextSelected : null,
                        ]}
                      >
                        {format(day, "d")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.72)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: theme.spacing[16],
    },
    sheetWrap: {
      width: "100%",
      maxWidth: 420,
    },
    card: {
      borderRadius: theme.radius.xl,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
      gap: theme.spacing[8],
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.spacing[4],
    },
    navBtn: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    weekRow: {
      flexDirection: "row",
    },
    weekLabel: {
      flexBasis: "14.2857%",
      textAlign: "center",
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    dayCell: {
      flexBasis: "14.2857%",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing[4],
    },
    dayInner: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    daySelected: {
      backgroundColor: theme.colors.accent,
    },
    dayToday: {
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.accent,
    },
    dayText: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    dayTextMuted: {
      color: theme.colors.textMuted,
    },
    dayTextSelected: {
      color: theme.colors.textPrimary,
    },
  });
}
