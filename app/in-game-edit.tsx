import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  ScaleDecorator,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { SafeAreaView } from "react-native-safe-area-context";

import Card from "@/components/ui/Card";
import { useSettings } from "@/src/settings/SettingsContext";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import {
  getDefaultInGameSectionLayout,
  getInGameSectionDefinitionMap,
  resolveInGameSectionIds,
  sanitizeInGameSectionLayout,
  type InGameSectionLayout,
} from "@/src/ui/inGameSectionLayouts";
import { isInGameRouteKey, type InGameRouteKey } from "@/src/ui/inGameRoutes";
import {
  BASE_IN_GAME_TAB_ITEMS,
  getDefaultInGameTabLayout,
  sanitizeInGameTabLayout,
  type InGameTabLayout,
} from "@/src/ui/inGameTabs";

type EditableRow = {
  id: string;
  label: string;
  hidden: boolean;
  subtitle: string;
};

function parseAvailableIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function mergeAvailableOrder(
  fullOrder: readonly string[],
  availableIds: readonly string[],
  nextAvailableOrder: readonly string[],
): string[] {
  const availableSet = new Set(availableIds);
  const queue = [...nextAvailableOrder];
  return fullOrder.map((id) => {
    if (!availableSet.has(id)) {
      return id;
    }
    return queue.shift() ?? id;
  });
}

function layoutsMatch(
  persisted: { order: readonly string[]; hidden: readonly string[] } | null,
  draft: { order: readonly string[]; hidden: readonly string[] } | null,
): boolean {
  if (!persisted || !draft) {
    return persisted === draft;
  }
  return (
    JSON.stringify(persisted.order) === JSON.stringify(draft.order) &&
    JSON.stringify([...persisted.hidden].sort()) ===
      JSON.stringify([...draft.hidden].sort())
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    header: {
      paddingHorizontal: theme.spacing[12],
      paddingTop: theme.spacing[10],
      paddingBottom: theme.spacing[12],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.bg,
    },
    headerAction: {
      minWidth: 64,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[8],
    },
    headerActionText: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    headerActionDisabled: {
      opacity: 0.4,
    },
    headerTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    scrollContent: {
      paddingHorizontal: theme.spacing[12],
      paddingTop: theme.spacing[12],
      paddingBottom: theme.spacing[20],
      gap: theme.spacing[12],
    },
    resetButton: {
      alignSelf: "flex-start",
      minHeight: 34,
      paddingHorizontal: theme.spacing[10],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    resetText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textSecondary,
    },
    helperText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    sectionCard: {
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
      gap: theme.spacing[10],
    },
    sectionHeader: {
      gap: theme.spacing[4],
    },
    sectionEyebrow: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    sectionTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    sectionDescription: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    listContent: {
      gap: theme.spacing[8],
    },
    rowCard: {
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
    },
    rowCardActive: {
      opacity: 0.92,
      transform: [{ scale: 1.01 }],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[4],
    },
    rowTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    rowSubtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    visibilityWrap: {
      alignItems: "center",
      gap: theme.spacing[4],
    },
    visibilityLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },
    handleButton: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyWrap: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[24],
      paddingVertical: theme.spacing[24],
      gap: theme.spacing[8],
    },
    emptyTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    emptyText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
  });
}

export default function InGameEditScreen() {
  const params = useLocalSearchParams<{
    tab?: string | string[];
    available?: string | string[];
  }>();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, setInGameSectionLayout, setInGameTabLayout } = useSettings();
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tabKey = isInGameRouteKey(rawTab) ? rawTab : null;
  const availableIds = useMemo(() => parseAvailableIds(params.available), [params.available]);
  const tabItemMap = useMemo(
    () => new Map(BASE_IN_GAME_TAB_ITEMS.map((item) => [item.key, item])),
    [],
  );
  const launchTabLabel = tabKey ? tabItemMap.get(tabKey)?.label ?? "This Tab" : "This Tab";
  const definitionMap = useMemo(
    () =>
      tabKey
        ? getInGameSectionDefinitionMap(tabKey)
        : new Map<string, { id: string; label: string }>(),
    [tabKey],
  );

  const persistedTabLayout = useMemo(
    () => sanitizeInGameTabLayout(state.inGame.tabLayout),
    [state.inGame.tabLayout],
  );
  const persistedSectionLayout = useMemo(
    () =>
      tabKey
        ? sanitizeInGameSectionLayout(tabKey, state.inGame.sectionLayoutsByTab[tabKey])
        : null,
    [state.inGame.sectionLayoutsByTab, tabKey],
  );

  const [draftTabLayout, setDraftTabLayout] = useState<InGameTabLayout>(persistedTabLayout);
  const [draftSectionLayout, setDraftSectionLayout] = useState<InGameSectionLayout | null>(
    persistedSectionLayout,
  );

  useEffect(() => {
    setDraftTabLayout(persistedTabLayout);
  }, [persistedTabLayout]);

  useEffect(() => {
    setDraftSectionLayout(persistedSectionLayout);
  }, [persistedSectionLayout]);

  const tabRows = useMemo<EditableRow[]>(
    () =>
      draftTabLayout.order.map((id) => {
        const item = tabItemMap.get(id);
        return {
          id,
          label: item?.label ?? id,
          hidden: draftTabLayout.hidden.includes(id),
          subtitle: draftTabLayout.hidden.includes(id)
            ? "Hidden from the in-game slider"
            : "Visible in the in-game slider",
        };
      }),
    [draftTabLayout.hidden, draftTabLayout.order, tabItemMap],
  );

  const sectionRows = useMemo<EditableRow[]>(() => {
    if (!tabKey || !draftSectionLayout) {
      return [];
    }
    const { orderedIds, hiddenIds } = resolveInGameSectionIds(
      tabKey,
      { [tabKey]: draftSectionLayout },
      availableIds,
    );
    return orderedIds.map((id) => ({
      id,
      label: definitionMap.get(id)?.label ?? id,
      hidden: hiddenIds.includes(id),
      subtitle: hiddenIds.includes(id) ? "Hidden on this tab" : "Visible on this tab",
    }));
  }, [availableIds, definitionMap, draftSectionLayout, tabKey]);

  const isDirty = useMemo(
    () =>
      !layoutsMatch(persistedTabLayout, draftTabLayout) ||
      !layoutsMatch(persistedSectionLayout, draftSectionLayout),
    [draftSectionLayout, draftTabLayout, persistedSectionLayout, persistedTabLayout],
  );

  const onCancel = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert("Discard changes?", "Your screen edits have not been saved.", [
      { text: "Keep Editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          router.back();
        },
      },
    ]);
  }, [isDirty]);

  const onSave = useCallback(() => {
    setInGameTabLayout(sanitizeInGameTabLayout(draftTabLayout));
    if (tabKey && draftSectionLayout) {
      setInGameSectionLayout(tabKey, draftSectionLayout);
    }
    router.back();
  }, [draftSectionLayout, draftTabLayout, setInGameSectionLayout, setInGameTabLayout, tabKey]);

  const onReset = useCallback(() => {
    setDraftTabLayout(getDefaultInGameTabLayout());
    if (tabKey) {
      setDraftSectionLayout(getDefaultInGameSectionLayout(tabKey));
    }
  }, [tabKey]);

  const toggleTabHidden = useCallback((id: string) => {
    setDraftTabLayout((current) => {
      const isHidden = current.hidden.includes(id as InGameRouteKey);
      if (!isHidden) {
        const visibleCount = current.order.filter((key) => !current.hidden.includes(key)).length;
        if (visibleCount <= 1) {
          Alert.alert("Keep one tab visible", "At least one in-game tab must remain visible.");
          return current;
        }
      }

      const nextHidden = isHidden
        ? current.hidden.filter((item) => item !== id)
        : [...current.hidden, id as InGameRouteKey];
      return sanitizeInGameTabLayout({
        order: current.order,
        hidden: nextHidden,
      });
    });
  }, []);

  const toggleSectionHidden = useCallback((id: string) => {
    setDraftSectionLayout((current) => {
      if (!current) {
        return current;
      }
      const hidden = current.hidden.includes(id)
        ? current.hidden.filter((item) => item !== id)
        : [...current.hidden, id];
      return {
        ...current,
        hidden,
      };
    });
  }, []);

  const renderEditableRow = useCallback(
    ({
      item,
      drag,
      isActive,
      onToggle,
    }: RenderItemParams<EditableRow> & { onToggle: (id: string) => void }) => (
      <ScaleDecorator>
        <Card style={[styles.rowCard, isActive ? styles.rowCardActive : null]}>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{item.label}</Text>
              <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
            </View>
            <View style={styles.visibilityWrap}>
              <Text style={styles.visibilityLabel}>{item.hidden ? "Show" : "Hide"}</Text>
              <Switch
                value={!item.hidden}
                onValueChange={() => onToggle(item.id)}
                trackColor={{
                  false: theme.colors.borderSoft,
                  true: theme.colors.accent,
                }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Pressable
              delayLongPress={120}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                drag();
              }}
              style={styles.handleButton}
            >
              <FontAwesome name="bars" size={16} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
        </Card>
      </ScaleDecorator>
    ),
    [styles, theme.colors.accent, theme.colors.borderSoft, theme.colors.textSecondary],
  );

  const renderTabRow = useCallback(
    (params: RenderItemParams<EditableRow>) =>
      renderEditableRow({ ...params, onToggle: toggleTabHidden }),
    [renderEditableRow, toggleTabHidden],
  );

  const renderSectionRow = useCallback(
    (params: RenderItemParams<EditableRow>) =>
      renderEditableRow({ ...params, onToggle: toggleSectionHidden }),
    [renderEditableRow, toggleSectionHidden],
  );

  if (!tabKey || !draftSectionLayout) {
    return (
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.screen}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Unavailable Screen</Text>
          <Text style={styles.emptyText}>This edit screen could not load the selected tab.</Text>
          <Pressable style={styles.resetButton} onPress={() => router.back()}>
            <Text style={styles.resetText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} style={styles.headerAction}>
          <Text style={styles.headerActionText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit Screen</Text>
        <Pressable
          onPress={onSave}
          style={[styles.headerAction, !isDirty ? styles.headerActionDisabled : null]}
          disabled={!isDirty}
        >
          <Text style={styles.headerActionText}>Save</Text>
        </Pressable>
      </View>

      <NestableScrollContainer contentContainerStyle={styles.scrollContent}>
        <Pressable onPress={onReset} style={styles.resetButton}>
          <Text style={styles.resetText}>Reset to Default</Text>
        </Pressable>
        <Text style={styles.helperText}>
          Press and hold a handle to reorder. Hidden tabs stay available here so you can bring
          them back later.
        </Text>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Tabs</Text>
            <Text style={styles.sectionTitle}>In-Game Tab Slider</Text>
            <Text style={styles.sectionDescription}>
              Rearrange or hide the tabs shown across every in-game screen.
            </Text>
          </View>
          <NestableDraggableFlatList
            data={tabRows}
            keyExtractor={(item) => item.id}
            renderItem={renderTabRow}
            contentContainerStyle={styles.listContent}
            activationDistance={12}
            scrollEnabled={false}
            onDragEnd={({ data }) => {
              setDraftTabLayout((current) =>
                sanitizeInGameTabLayout({
                  order: data.map((item) => item.id as InGameRouteKey),
                  hidden: current.hidden,
                }),
              );
              void Haptics.selectionAsync();
            }}
          />
        </Card>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>{launchTabLabel}</Text>
            <Text style={styles.sectionTitle}>This Tab’s Sections</Text>
            <Text style={styles.sectionDescription}>
              Change the cards and modules shown only on the {launchTabLabel} tab.
            </Text>
          </View>

          {sectionRows.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No Sections Available</Text>
              <Text style={styles.emptyText}>
                This tab does not have any editable sections right now.
              </Text>
            </View>
          ) : (
            <NestableDraggableFlatList
              data={sectionRows}
              keyExtractor={(item) => item.id}
              renderItem={renderSectionRow}
              contentContainerStyle={styles.listContent}
              activationDistance={12}
              scrollEnabled={false}
              onDragEnd={({ data }) => {
                const nextOrder = data.map((item) => item.id);
                const effectiveAvailableIds = sectionRows.map((item) => item.id);
                setDraftSectionLayout((current) => {
                  if (!current) {
                    return current;
                  }
                  return {
                    ...current,
                    order: mergeAvailableOrder(current.order, effectiveAvailableIds, nextOrder),
                  };
                });
                void Haptics.selectionAsync();
              }}
            />
          )}
        </Card>
      </NestableScrollContainer>
    </SafeAreaView>
  );
}
