import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { runOnJS, useAnimatedScrollHandler } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IN_GAME_HEADER_COLLAPSE_RANGE } from "@/components/ui/inGameHeaderMetrics";
import { useLiveGame } from "@/hooks/useLiveGame";
import {
  getGameComments,
  postGameComment,
  type GameComment,
} from "@/src/features/basketball/api";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGameHeaderScroll } from "@/src/ui/inGameHeaderScrollContext";

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
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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

type InGameCommentsPanelProps = {
  enabled: boolean;
  onPullPastTop?: () => void;
  onScrollAwayFromTop?: () => void;
  onScrollTowardTopAtTop?: () => void;
};

export default function InGameCommentsPanel({
  enabled,
  onPullPastTop,
  onScrollAwayFromTop,
  onScrollTowardTopAtTop,
}: InGameCommentsPanelProps) {
  const { gameId, mode } = useLiveGame();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { sharedHeaderScrollY } = useInGameHeaderScroll();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const listRef = useRef<FlatList<GameComment>>(null);
  const commentsRef = useRef<GameComment[]>([]);
  const nearBottomRef = useRef(true);
  const pendingScrollToBottomRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const localScrollYRef = useRef(0);
  const previousListOffsetYRef = useRef(0);

  const [authorName, setAuthorName] = useState("");
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState<GameComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const trimmedAuthor = useMemo(
    () => authorName.trim().replace(/\s+/g, " ").slice(0, MAX_AUTHOR_LENGTH),
    [authorName],
  );
  const trimmedDraft = useMemo(() => draft.trim().slice(0, MAX_BODY_LENGTH), [draft]);
  const composerInitials = useMemo(
    () => getAuthorInitials(trimmedAuthor || "Anonymous"),
    [trimmedAuthor],
  );
  const composerAvatarTone = useMemo(
    () => getAvatarTone(trimmedAuthor || "Anonymous"),
    [trimmedAuthor],
  );

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

  // JS-thread side effects of a scroll frame — pull-to-dismiss detection and
  // the "near bottom" tracking used for auto-scroll-on-new-comment. None of
  // this needs to run before paint, so it's dispatched via runOnJS from the
  // worklet below rather than being the worklet body itself; the one thing
  // that DOES need to happen synchronously on the UI thread (writing
  // sharedHeaderScrollY, which the header's own rendering reads every frame)
  // stays directly in the worklet.
  const handleScrollSideEffects = useCallback(
    (nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
      isDragging?: boolean;
    }) => {
      const offsetY = nativeEvent.contentOffset.y;
      const previousOffsetY = previousListOffsetYRef.current;
      localScrollYRef.current = offsetY;
      if (nativeEvent.isDragging && offsetY < -24) {
        onPullPastTop?.();
      } else if (nativeEvent.isDragging && offsetY > previousOffsetY + 6) {
        onScrollAwayFromTop?.();
      } else if (
        nativeEvent.isDragging &&
        offsetY <= 0.5 &&
        previousOffsetY <= 0.5
      ) {
        onScrollTowardTopAtTop?.();
      }
      previousListOffsetYRef.current = offsetY;
      updateNearBottom(nativeEvent);
    },
    [onPullPastTop, onScrollAwayFromTop, onScrollTowardTopAtTop, updateNearBottom],
  );

  // Worklet-based (was a plain onScroll prop bridged through the JS thread) —
  // see components/GameTabScreenScaffold.tsx for the full explanation of why
  // that pattern let sharedHeaderScrollY fall behind under fast scrolling.
  // Matches app/(tabs)/comments.tsx's already-correct handling of this exact
  // same shared value.
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const nativeEvent = event as unknown as {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
        isDragging?: boolean;
        isDecelerating?: boolean;
      };
      const offsetY = nativeEvent.contentOffset.y;
      const isUserDriven =
        nativeEvent.isDragging || nativeEvent.isDecelerating || offsetY > 0.5;
      if (isUserDriven) {
        sharedHeaderScrollY.value = offsetY;
      }
      runOnJS(handleScrollSideEffects)(nativeEvent);
    },
  });

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
        const rows = await getGameComments(mode, gameId, COMMENTS_LIMIT);
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
    if (!enabled) {
      return;
    }
    nearBottomRef.current = true;
    pendingScrollToBottomRef.current = false;
    initialScrollDoneRef.current = false;
    previousListOffsetYRef.current = 0;
    setComments([]);
    commentsRef.current = [];
    setLoading(true);
    setError(null);
  }, [enabled, gameId, sharedHeaderScrollY]);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }
    if (localScrollYRef.current > 1) {
      return;
    }
    const targetOffset = Math.min(
      Math.max(sharedHeaderScrollY.value, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (targetOffset <= 0) {
      return;
    }
    localScrollYRef.current = targetOffset;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
    });
  }, [enabled, isFocused, sharedHeaderScrollY]);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }

    void loadComments("initial");
    const intervalId = setInterval(() => {
      void loadComments("poll");
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, isFocused, loadComments]);

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
      });
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
  }, [applyComments, gameId, mode, trimmedAuthor, trimmedDraft]);

  if (!enabled) {
    return null;
  }

  return (
    <View style={styles.panel}>
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
        onScroll={onScroll}
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
              <ActivityIndicator color={theme.colors.accentStrong} />
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
        ListFooterComponent={
          error && comments.length > 0 ? (
            <Text style={styles.inlineError}>{error}</Text>
          ) : null
        }
      />

      <View
        style={[
          styles.composerWrap,
          { paddingBottom: Math.max(insets.bottom, theme.spacing[12]) },
        ]}
      >
        <View style={styles.authorRow}>
          <Text style={styles.authorLabel}>Posting as</Text>
          <TextInput
            value={authorName}
            onChangeText={(value) => setAuthorName(value.slice(0, MAX_AUTHOR_LENGTH))}
            onBlur={() => {
              void persistAuthor();
            }}
            placeholder="Anonymous name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.authorInput}
          />
        </View>

        <View style={styles.composerBar}>
          <View style={[styles.composerAvatar, composerAvatarTone]}>
            <Text style={styles.avatarText}>{composerInitials}</Text>
          </View>
          <TextInput
            value={draft}
            onChangeText={(value) => setDraft(value.slice(0, MAX_BODY_LENGTH))}
            placeholder="What do you think?"
            placeholderTextColor={theme.colors.textMuted}
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
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
    panel: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: theme.spacing[10],
      paddingTop: theme.spacing[14],
      paddingBottom: theme.spacing[16],
      gap: theme.spacing[14],
    },
    listContentEmpty: {
      flexGrow: 1,
      justifyContent: "center",
    },
    centerState: {
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[8],
      paddingHorizontal: theme.spacing[24],
    },
    stateText: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
    emptyTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    inlineError: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.danger,
      textAlign: "center",
      marginTop: theme.spacing[8],
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.spacing[10],
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing[4],
    },
    avatarText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    messageContent: {
      maxWidth: "82%",
      gap: theme.spacing[4],
    },
    messageAuthor: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      paddingHorizontal: theme.spacing[4],
    },
    messageBubble: {
      borderRadius: theme.radius.xl,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[14],
      paddingTop: theme.spacing[12],
      paddingBottom: theme.spacing[8],
      gap: theme.spacing[6],
    },
    messageBody: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
      color: theme.colors.textPrimary,
    },
    messageTime: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textAlign: "right",
    },
    composerWrap: {
      borderTopWidth: theme.borderWidth.normal,
      borderTopColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.bg,
      paddingHorizontal: theme.spacing[10],
      paddingTop: theme.spacing[10],
      gap: theme.spacing[8],
    },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    authorLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    authorInput: {
      flex: 1,
      minHeight: 34,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing[8],
      color: theme.colors.textPrimary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
    },
    composerBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.spacing[10],
    },
    composerAvatar: {
      width: 38,
      height: 38,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing[6],
    },
    messageInput: {
      flex: 1,
      minHeight: 52,
      maxHeight: 112,
      borderRadius: theme.radius.xl,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[14],
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    sendButton: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accentStrong,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing[2],
    },
    sendButtonPressed: {
      opacity: 0.85,
    },
    sendButtonDisabled: {
      opacity: 0.55,
    },
    errorText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.danger,
    },
  });
}
