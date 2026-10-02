import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";

import {
  getStickyHeaderExpandedHeight,
  IN_GAME_HEADER_COLLAPSE_RANGE,
} from "@/components/ui/inGameHeaderMetrics";
import { useLiveGame } from "@/hooks/useLiveGame";
import { getGameComments, postGameComment, type GameComment } from "@/src/features/basketball/api";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { tokens } from "@/src/theme/tokens";
import { typography } from "@/src/theme/typography";
import { useInGameHeaderScroll } from "@/src/ui/inGameHeaderScrollContext";
import { resolveInGameSectionIds } from "@/src/ui/inGameSectionLayouts";
import { useRegisterInGameSections } from "@/src/ui/useRegisterInGameSections";

const AUTHOR_STORAGE_KEY = "comments:authorName";
const MAX_AUTHOR_LENGTH = 32;
const MAX_BODY_LENGTH = 500;
const COMMENTS_LIMIT = 100;
const POLL_INTERVAL_MS = 4000;
const NEAR_BOTTOM_THRESHOLD_PX = 96;

const AVATAR_STYLES = [
  { backgroundColor: "rgba(108,192,255,0.18)", borderColor: "rgba(108,192,255,0.34)" },
  { backgroundColor: "rgba(240,198,93,0.18)", borderColor: "rgba(240,198,93,0.34)" },
  { backgroundColor: "rgba(49,208,125,0.16)", borderColor: "rgba(49,208,125,0.34)" },
  { backgroundColor: "rgba(241,102,102,0.18)", borderColor: "rgba(241,102,102,0.34)" },
] as const;

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeComments(rows: GameComment[]): GameComment[] {
  return [...rows].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id - b.id;
  });
}

function mergeComments(existing: GameComment[], nextRows: GameComment[]): GameComment[] {
  const byId = new Map<number, GameComment>();
  existing.forEach((comment) => byId.set(comment.id, comment));
  nextRows.forEach((comment) => byId.set(comment.id, comment));
  return normalizeComments([...byId.values()]);
}

function getAuthorInitials(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "?";
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function getAvatarTone(value: string) {
  const seed = [...value].reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_STYLES[seed % AVATAR_STYLES.length];
}

type CommentMessageRowProps = {
  comment: GameComment;
};

function CommentMessageRow({ comment }: CommentMessageRowProps) {
  const avatarTone = useMemo(() => getAvatarTone(comment.authorName), [comment.authorName]);
  const initials = useMemo(() => getAuthorInitials(comment.authorName), [comment.authorName]);

  return (
    <View style={styles.messageRow}>
      <View style={[styles.avatar, avatarTone]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.messageContent}>
        <Text style={styles.messageAuthor} numberOfLines={1}>
          {comment.authorName}
        </Text>
        <View style={styles.messageBubble}>
          <Text style={styles.messageBody}>{comment.body}</Text>
          <Text style={styles.messageTime}>{formatCommentTime(comment.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function CommentsTab() {
  const { gameId, mode, proLeague } = useLiveGame();
  const { state: settingsState } = useSettingsState();
  const { sharedHeaderScrollY } = useInGameHeaderScroll();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const headerSpace = getStickyHeaderExpandedHeight(insets.top);
  const listRef = useRef<FlatList<GameComment>>(null);
  const isFocusedRef = useRef(isFocused);
  const isFocusedShared = useSharedValue(isFocused ? 1 : 0);
  const commentsRef = useRef<GameComment[]>([]);
  const nearBottomRef = useRef(true);
  const pendingScrollToBottomRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const localScrollYRef = useRef(0);

  const [authorName, setAuthorName] = useState("");
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState<GameComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const availableSectionIds = useMemo(() => ["comments"], []);
  useRegisterInGameSections("comments", availableSectionIds);
  const visibleSectionIds = useMemo(
    () =>
      resolveInGameSectionIds(
        "comments",
        settingsState.inGame.sectionLayoutsByTab,
        availableSectionIds,
      ).visibleIds,
    [availableSectionIds, settingsState.inGame.sectionLayoutsByTab],
  );

  const trimmedAuthor = useMemo(
    () => authorName.trim().replace(/\s+/g, " ").slice(0, MAX_AUTHOR_LENGTH),
    [authorName],
  );
  const trimmedDraft = useMemo(() => draft.trim().slice(0, MAX_BODY_LENGTH), [draft]);
  const setLocalScrollY = useCallback((value: number) => {
    localScrollYRef.current = value;
  }, []);

  const scrollToBottom = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const updateNearBottom = useCallback(
    (nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    }) => {
      const distanceFromBottom =
        nativeEvent.contentSize.height -
        (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height);
      nearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    },
    [],
  );

  const applyComments = useCallback(
    (nextRows: GameComment[], options?: { shouldScroll?: boolean }) => {
      const normalized = normalizeComments(nextRows);
      commentsRef.current = normalized;
      pendingScrollToBottomRef.current = Boolean(options?.shouldScroll);
      setComments(normalized);
    },
    [],
  );

  const loadComments = useCallback(
    async (loadMode: "initial" | "refresh" | "poll" = "initial") => {
      if (!gameId) {
        commentsRef.current = [];
        setComments([]);
        setError("Missing game id.");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (loadMode === "initial") {
        setLoading(true);
      }
      if (loadMode === "refresh") {
        setRefreshing(true);
      }

      try {
        const rows = await getGameComments(mode, gameId, COMMENTS_LIMIT, proLeague);
        const normalized = normalizeComments(rows);
        const previousLastId = commentsRef.current[commentsRef.current.length - 1]?.id ?? null;
        const nextLastId = normalized[normalized.length - 1]?.id ?? null;
        const shouldScroll =
          loadMode === "initial" ||
          loadMode === "refresh" ||
          ((previousLastId !== nextLastId || normalized.length !== commentsRef.current.length) &&
            nearBottomRef.current);

        applyComments(normalized, { shouldScroll });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load comments right now.");
      } finally {
        if (loadMode === "initial") {
          setLoading(false);
        }
        if (loadMode === "refresh") {
          setRefreshing(false);
        }
      }
    },
    [applyComments, gameId],
  );

  useEffect(() => {
    void AsyncStorage.getItem(AUTHOR_STORAGE_KEY).then((value) => {
      if (value) {
        setAuthorName(value);
      }
    });
  }, []);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    nearBottomRef.current = true;
    pendingScrollToBottomRef.current = false;
    initialScrollDoneRef.current = false;
    setComments([]);
    commentsRef.current = [];
    setLoading(true);
    setError(null);
  }, [gameId, sharedHeaderScrollY]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    void loadComments("initial");

    const intervalId = setInterval(() => {
      void loadComments("poll");
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isFocused, loadComments]);

  useEffect(() => {
    isFocusedRef.current = isFocused;
    isFocusedShared.value = isFocused ? 1 : 0;
  }, [isFocused, isFocusedShared]);

  const syncCollapsedOffset = useCallback((sourceOffset: number) => {
    if (isFocusedRef.current) {
      return;
    }
    const targetOffset = Math.min(
      Math.max(sourceOffset, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (Math.abs(localScrollYRef.current - targetOffset) < 1) {
      return;
    }
    localScrollYRef.current = targetOffset;
    listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
  }, []);

  useAnimatedReaction(
    () => sharedHeaderScrollY.value,
    (value) => {
      runOnJS(syncCollapsedOffset)(value);
    },
    [sharedHeaderScrollY, syncCollapsedOffset],
  );

  useLayoutEffect(() => {
    if (!isFocused) {
      return;
    }
    // Reconcile in both directions on focus (see GameTabScreenScaffold for
    // why the "already scrolled" guard was removed): a stale scrolled-down
    // offset must snap back to 0 when another tab expanded the header,
    // otherwise this tab keeps re-forcing the header back into collapsed.
    const targetOffset = Math.min(
      Math.max(sharedHeaderScrollY.value, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (Math.abs(localScrollYRef.current - targetOffset) < 1) {
      return;
    }
    localScrollYRef.current = targetOffset;
    listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
  }, [isFocused, sharedHeaderScrollY]);

  const onCommentsScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const nativeEvent = event as unknown as {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
        isDragging: boolean;
        isDecelerating: boolean;
      };
      if (isFocusedShared.value !== 1) {
        return;
      }
      const offsetY = nativeEvent.contentOffset.y;
      runOnJS(setLocalScrollY)(offsetY);
      const isUserDriven =
        nativeEvent.isDragging || nativeEvent.isDecelerating || offsetY > 0.5;
      if (isUserDriven) {
        sharedHeaderScrollY.value = offsetY;
      }
      runOnJS(updateNearBottom)(nativeEvent);
    },
  });

  const persistAuthor = useCallback(async () => {
    if (!trimmedAuthor) {
      return;
    }
    await AsyncStorage.setItem(AUTHOR_STORAGE_KEY, trimmedAuthor);
  }, [trimmedAuthor]);

  const onPost = useCallback(async () => {
    if (!gameId) {
      setPostError("Missing game id.");
      return;
    }
    if (!trimmedAuthor) {
      setPostError("Enter a name.");
      return;
    }
    if (!trimmedDraft) {
      setPostError("Enter a comment.");
      return;
    }

    setPosting(true);
    setPostError(null);

    try {
      const created = await postGameComment(mode, gameId, {
        authorName: trimmedAuthor,
        body: trimmedDraft,
      }, proLeague);
      await AsyncStorage.setItem(AUTHOR_STORAGE_KEY, trimmedAuthor);
      const merged = mergeComments(commentsRef.current, [created]);
      applyComments(merged, { shouldScroll: true });
      setDraft("");
      nearBottomRef.current = true;
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Could not post comment right now.");
    } finally {
      setPosting(false);
    }
  }, [applyComments, gameId, mode, proLeague, trimmedAuthor, trimmedDraft]);

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.contentWrap, { paddingTop: headerSpace }]}
      >
        {visibleSectionIds.includes("comments") ? (
          <>
            <Animated.FlatList
              ref={listRef}
              data={comments}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => <CommentMessageRow comment={item} />}
              style={styles.list}
              contentContainerStyle={[
                styles.listContent,
                comments.length === 0 ? styles.listContentEmpty : null,
              ]}
              keyboardShouldPersistTaps="handled"
              refreshing={refreshing}
              onRefresh={() => void loadComments("refresh")}
              onScroll={onCommentsScroll}
              onContentSizeChange={() => {
                if (!commentsRef.current.length) {
                  return;
                }
                if (pendingScrollToBottomRef.current) {
                  scrollToBottom(initialScrollDoneRef.current);
                  pendingScrollToBottomRef.current = false;
                  initialScrollDoneRef.current = true;
                }
              }}
              scrollEventThrottle={16}
              ListEmptyComponent={
                loading ? (
                  <View style={styles.centerState}>
                    <ActivityIndicator color={tokens.colors.accentStrong} />
                    <Text style={styles.stateText}>Loading comments...</Text>
                  </View>
                ) : error ? (
                  <View style={styles.centerState}>
                    <Text style={styles.errorText}>Could not load comments right now.</Text>
                  </View>
                ) : (
                  <View style={styles.centerState}>
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.stateText}>Start the conversation.</Text>
                  </View>
                )
              }
              ListFooterComponent={error && comments.length > 0 ? <Text style={styles.inlineError}>{error}</Text> : null}
            />

            <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, tokens.spacing[12]) }]}>
              <View style={styles.authorRow}>
                <Text style={styles.authorLabel}>Posting as</Text>
                <TextInput
                  value={authorName}
                  onChangeText={(value) => setAuthorName(value.slice(0, MAX_AUTHOR_LENGTH))}
                  onBlur={() => {
                    void persistAuthor();
                  }}
                  placeholder="Anonymous name"
                  placeholderTextColor={tokens.colors.textMuted}
                  style={styles.authorInput}
                />
              </View>

              <View style={styles.composerBar}>
                <TextInput
                  value={draft}
                  onChangeText={(value) => setDraft(value.slice(0, MAX_BODY_LENGTH))}
                  placeholder="Message"
                  placeholderTextColor={tokens.colors.textMuted}
                  style={styles.messageInput}
                  multiline
                  maxLength={MAX_BODY_LENGTH}
                />
                <Pressable
                  onPress={() => void onPost()}
                  disabled={posting}
                  style={({ pressed }) => [
                    styles.sendButton,
                    posting ? styles.sendButtonDisabled : null,
                    pressed ? styles.sendButtonPressed : null,
                  ]}
                >
                  <FontAwesome name="send" size={16} color="#0b1220" />
                </Pressable>
              </View>

              {postError ? <Text style={styles.errorText}>{postError}</Text> : null}
            </View>
          </>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>Comments Hidden</Text>
            <Text style={styles.stateText}>Use Edit Screen to show this section again.</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.bg,
  },
  contentWrap: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: tokens.spacing[10],
    paddingTop: tokens.spacing[14],
    paddingBottom: tokens.spacing[16],
    gap: tokens.spacing[14],
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacing[8],
    paddingHorizontal: tokens.spacing[24],
  },
  stateText: {
    ...typography.body,
    color: tokens.colors.textSecondary,
    textAlign: "center",
  },
  emptyTitle: {
    ...typography.subtitle,
    textAlign: "center",
  },
  inlineError: {
    ...typography.meta,
    color: tokens.colors.danger,
    textAlign: "center",
    marginTop: tokens.spacing[8],
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: tokens.spacing[10],
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: tokens.radius.pill,
    borderWidth: tokens.borderWidth.normal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tokens.spacing[4],
  },
  avatarText: {
    ...typography.meta,
    color: tokens.colors.textPrimary,
    fontWeight: "800",
  },
  messageContent: {
    maxWidth: "82%",
    gap: tokens.spacing[4],
  },
  messageAuthor: {
    ...typography.body,
    fontWeight: "800",
    color: tokens.colors.textPrimary,
    paddingHorizontal: tokens.spacing[4],
  },
  messageBubble: {
    borderRadius: tokens.radius.xl,
    borderWidth: tokens.borderWidth.normal,
    borderColor: tokens.colors.borderSoft,
    backgroundColor: tokens.colors.surfaceAlt,
    paddingHorizontal: tokens.spacing[14],
    paddingTop: tokens.spacing[12],
    paddingBottom: tokens.spacing[8],
    gap: tokens.spacing[6],
  },
  messageBody: {
    ...typography.body,
    color: tokens.colors.textPrimary,
  },
  messageTime: {
    ...typography.micro,
    color: tokens.colors.textMuted,
    textAlign: "right",
  },
  composerWrap: {
    borderTopWidth: tokens.borderWidth.normal,
    borderTopColor: tokens.colors.borderSoft,
    backgroundColor: tokens.colors.bg,
    paddingHorizontal: tokens.spacing[10],
    paddingTop: tokens.spacing[10],
    gap: tokens.spacing[8],
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing[8],
  },
  authorLabel: {
    ...typography.micro,
    color: tokens.colors.textMuted,
  },
  authorInput: {
    flex: 1,
    minHeight: 34,
    borderRadius: tokens.radius.pill,
    borderWidth: tokens.borderWidth.normal,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    paddingHorizontal: tokens.spacing[12],
    color: tokens.colors.textPrimary,
    ...typography.meta,
  },
  composerBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: tokens.spacing[10],
  },
  messageInput: {
    flex: 1,
    minHeight: 52,
    maxHeight: 112,
    borderRadius: tokens.radius.xl,
    borderWidth: tokens.borderWidth.normal,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surfaceAlt,
    paddingHorizontal: tokens.spacing[16],
    paddingVertical: tokens.spacing[14],
    color: tokens.colors.textPrimary,
    ...typography.body,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tokens.spacing[2],
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendButtonDisabled: {
    opacity: 0.55,
  },
  errorText: {
    ...typography.meta,
    color: tokens.colors.danger,
  },
});
