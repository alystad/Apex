import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import TabContentSkeleton from "@/components/loading/TabContentSkeleton";
import MomentumTopStatsCard from "@/components/MomentumTopStatsCard";
import Card from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import SectionHeader from "@/components/ui/SectionHeader";
import { useLiveGame } from "@/hooks/useLiveGame";
import { fetchMatchedEventOdds } from "@/src/features/betting/api";
import {
  buildComputedMarketRows,
  type ComputedMarketRow,
} from "@/src/features/betting/proEv";
import {
  buildTrackedBetCandidateFromComputedMarketRow,
  buildTrackedBetGameSnapshotFromLiveGame,
} from "@/src/features/betting/trackedBets";
import type { BettingGame } from "@/src/features/betting/types";
import { useProfile } from "@/src/profile/ProfileContext";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { resolveInGameSectionIds } from "@/src/ui/inGameSectionLayouts";
import { useRegisterInGameSections } from "@/src/ui/useRegisterInGameSections";


type OddsOutcome = { name?: string; price?: number; point?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; title?: string; markets?: OddsMarket[] };
type OddsResponse = { bookmakers?: OddsBookmaker[] };
type BettingTabCacheEntry = {
  odds: OddsResponse | null;
  oddsEvent: BettingGame | null;
};

const bettingTabCache = new Map<string, BettingTabCacheEntry>();

// ─── Data helpers ────────────────────────────────────────────────────────────

function isFliffBook(row: ComputedMarketRow): boolean {
  return row.bookKey.trim().toLowerCase() === "fliff";
}

function selectDisplayedFliffRows(rows: ComputedMarketRow[]): ComputedMarketRow[] {
  const fliffRows = rows.filter(isFliffBook);
  const positiveRows = fliffRows.filter(
    (row) => typeof row.proEv === "number" && Number.isFinite(row.proEv) && row.proEv > 0,
  );
  return positiveRows.length > 5 ? positiveRows : fliffRows.slice(0, 5);
}

function formatOdds(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const n = Number(value);
  return n > 0 ? `+${n}` : `${n}`;
}

function formatPoint(value: number | undefined): string {
  if (!Number.isFinite(value)) return "";
  const n = Number(value);
  return n > 0 ? `+${n}` : `${n}`;
}

function formatEvPercent(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function normalizeTeamName(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

type BookOddsRow = {
  book: string;
  bookKey: string;
  awayOutcome: OddsOutcome | null;
  homeOutcome: OddsOutcome | null;
};

function matchOutcomeToTeam(
  outcomes: OddsOutcome[],
  teamDisplayName: string,
  teamShortName: string,
): OddsOutcome | null {
  const full = normalizeTeamName(teamDisplayName);
  const short = normalizeTeamName(teamShortName);
  return (
    outcomes.find((o) => {
      const name = normalizeTeamName(o.name);
      return name === full || name === short || (short && name.includes(short));
    }) ?? null
  );
}

function buildBookOddsRows(
  odds: OddsResponse | null,
  marketKey: "h2h" | "spreads",
  awayDisplayName: string,
  awayShortName: string,
  homeDisplayName: string,
  homeShortName: string,
): BookOddsRow[] {
  if (!odds?.bookmakers) return [];
  return odds.bookmakers
    .map((book): BookOddsRow | null => {
      const market = book.markets?.find(
        (m) => (m.key ?? "").toLowerCase() === marketKey,
      );
      if (!market?.outcomes || market.outcomes.length < 2) return null;
      const outcomes = market.outcomes;
      // Try to match by name; fall back to positional (index 0 = away, 1 = home)
      const awayOut =
        matchOutcomeToTeam(outcomes, awayDisplayName, awayShortName) ??
        outcomes[0] ??
        null;
      const homeOut =
        matchOutcomeToTeam(outcomes, homeDisplayName, homeShortName) ??
        outcomes[1] ??
        null;
      return {
        book: book.title || book.key || "Unknown",
        bookKey: book.key || "",
        awayOutcome: awayOut,
        homeOutcome: homeOut,
      };
    })
    .filter((row): row is BookOddsRow => row !== null);
}

// ─── Visual sub-components ───────────────────────────────────────────────────

function OddsPill({ price, point, showPoint }: { price?: number; point?: number; showPoint?: boolean }) {
  const { tokens: theme } = useAppTheme();
  const label = showPoint && Number.isFinite(point)
    ? `${formatPoint(point)} (${formatOdds(price)})`
    : formatOdds(price);
  const isPos = typeof price === "number" && price > 0;
  const bgColor = isPos
    ? "rgba(34,197,94,0.12)"
    : "rgba(148,163,184,0.10)";
  const textColor = isPos
    ? "#22c55e"
    : theme.colors.textSecondary;
  return (
    <View style={[oddsPillStyles.pill, { backgroundColor: bgColor }]}>
      <Text style={[oddsPillStyles.text, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const oddsPillStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  text: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});

function OddsMarketCard({
  title,
  rows,
  showPoint,
  awayName,
  homeName,
  empty,
}: {
  title: string;
  rows: BookOddsRow[];
  showPoint?: boolean;
  awayName: string;
  homeName: string;
  empty: string;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <Card padded={false}>
      <View style={oddsCardStyles.header}>
        <SectionHeader title={title} />
      </View>
      <View style={oddsCardStyles.headerRow}>
        <Text style={[oddsCardStyles.headerLabel, { color: theme.colors.textMuted }]}>Book</Text>
        <View style={oddsCardStyles.headerTeams}>
          <Text style={[oddsCardStyles.headerTeamName, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {awayName}
          </Text>
          <Text style={[oddsCardStyles.headerTeamName, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {homeName}
          </Text>
        </View>
      </View>
      {rows.length === 0 ? (
        <Text style={[oddsCardStyles.emptyText, { color: theme.colors.textMuted }]}>{empty}</Text>
      ) : null}
      {rows.map((row, i) => (
        <View key={`${row.bookKey}-${i}`} style={[oddsCardStyles.row, i < rows.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.borderSoft } : null]}>
          <Text style={[oddsCardStyles.bookName, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {row.book}
          </Text>
          <View style={oddsCardStyles.pillRow}>
            <OddsPill
              price={row.awayOutcome?.price}
              point={row.awayOutcome?.point}
              showPoint={showPoint}
            />
            <OddsPill
              price={row.homeOutcome?.price}
              point={row.homeOutcome?.point}
              showPoint={showPoint}
            />
          </View>
        </View>
      ))}
    </Card>
  );
}

const oddsCardStyles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  headerLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  headerTeams: { flexDirection: "row", gap: 8 },
  headerTeamName: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, width: 68, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  bookName: { fontSize: 13, fontWeight: "700", flex: 1, minWidth: 0 },
  pillRow: { flexDirection: "row", gap: 6 },
  emptyText: { fontSize: 13, fontWeight: "600", paddingHorizontal: 16, paddingVertical: 12 },
});

function ProEvRow({
  row,
}: {
  row: ComputedMarketRow;
}) {
  const { tokens: theme } = useAppTheme();
  const evPositive = (row.proEv ?? Number.NEGATIVE_INFINITY) >= 0;
  return (
    <View style={proEvStyles.row}>
      <View style={proEvStyles.rowLeft}>
        <Text style={[proEvStyles.rowMarket, { color: theme.colors.textMuted }]}>
          {row.market.toUpperCase()}
        </Text>
        <Text style={[proEvStyles.rowSide, { color: theme.colors.textPrimary }]} numberOfLines={1}>
          {row.side}
          {Number.isFinite(row.point) ? ` ${formatPoint(row.point)}` : ""}
        </Text>
      </View>
      <View style={proEvStyles.rowRight}>
        <Text style={[proEvStyles.rowOdds, { color: theme.colors.textSecondary }]}>
          {formatOdds(row.price)}
        </Text>
        <View style={[proEvStyles.evPill, evPositive ? proEvStyles.evPillPos : proEvStyles.evPillNeg]}>
          <Text style={[proEvStyles.evText, evPositive ? proEvStyles.evTextPos : proEvStyles.evTextNeg]}>
            {formatEvPercent(row.proEv)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const proEvStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  rowLeft: { flex: 1, minWidth: 0, gap: 2 },
  rowMarket: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  rowSide: { fontSize: 14, fontWeight: "800" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowOdds: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  evPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, minWidth: 60, alignItems: "center" },
  evPillPos: { backgroundColor: "rgba(34,197,94,0.12)" },
  evPillNeg: { backgroundColor: "rgba(239,68,68,0.10)" },
  evText: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  evTextPos: { color: "#22c55e" },
  evTextNeg: { color: "#ef4444" },
});

// ─── Main tab ────────────────────────────────────────────────────────────────

export default function BettingTab() {
  const { data } = useLiveGame();
  const { state: settingsState } = useSettingsState();
  const { tokens: theme } = useAppTheme();
  const {
    state: profileState,
    syncTrackedBetsFromSnapshots,
  } = useProfile();
  const teams = data?.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const isBaseball = data?.sport === "baseball";
  const sportKey = "basketball_ncaab";
  const cacheKey = useMemo(() => {
    if (!home || !away) return null;
    return [sportKey, home.displayName, away.displayName, data?.meta?.startDateTime ?? ""].join("|");
  }, [away, data?.meta?.startDateTime, home, sportKey]);

  const [odds, setOdds] = useState<OddsResponse | null>(null);
  const [oddsEvent, setOddsEvent] = useState<BettingGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOdds = useCallback(async (options?: { force?: boolean }) => {
    if (!home || !away || !cacheKey) {
      setOdds(null);
      setOddsEvent(null);
      setError(null);
      return;
    }
    if (!options?.force) {
      const cached = bettingTabCache.get(cacheKey);
      if (cached) {
        setOdds(cached.odds);
        setOddsEvent(cached.oddsEvent);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMatchedEventOdds({
        sportKey,
        homeTeam: home.displayName,
        homeShortTeam: home.shortDisplayName,
        homeAbbreviation: home.abbreviation,
        awayTeam: away.displayName,
        awayShortTeam: away.shortDisplayName,
        awayAbbreviation: away.abbreviation,
        startDateTime: data?.meta?.startDateTime,
        forceRefresh: options?.force,
      });
      if (!response.event?.eventId || !response.odds) {
        setOdds(null);
        setOddsEvent(null);
        setError("No odds found for this game yet.");
        bettingTabCache.delete(cacheKey);
        return;
      }
      const nextOdds = (response.odds as OddsResponse) ?? null;
      setOdds(nextOdds);
      setOddsEvent(response.event);
      bettingTabCache.set(cacheKey, { odds: nextOdds, oddsEvent: response.event });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load betting lines.");
    } finally {
      setLoading(false);
    }
  }, [away, cacheKey, data?.meta?.startDateTime, home, sportKey]);

  useEffect(() => { void loadOdds(); }, [loadOdds]);

  const trackedBetSnapshot = useMemo(() => buildTrackedBetGameSnapshotFromLiveGame(data), [data]);
  useEffect(() => {
    if (!trackedBetSnapshot) return;
    syncTrackedBetsFromSnapshots([trackedBetSnapshot]);
  }, [syncTrackedBetsFromSnapshots, trackedBetSnapshot]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadOdds({ force: true }); }
    finally { setRefreshing(false); }
  }, [loadOdds]);

  const marketRows = useMemo(
    () => buildComputedMarketRows(odds).sort((l, r) => {
      const le = typeof l.proEv === "number" && Number.isFinite(l.proEv) ? l.proEv : Number.NEGATIVE_INFINITY;
      const re = typeof r.proEv === "number" && Number.isFinite(r.proEv) ? r.proEv : Number.NEGATIVE_INFINITY;
      return le !== re ? re - le : l.book.localeCompare(r.book);
    }),
    [odds],
  );

  const fliffRows = useMemo(() => selectDisplayedFliffRows(marketRows), [marketRows]);
  const fliffEntries = useMemo(
    () => fliffRows.map((row) => ({
      row,
      candidate: buildTrackedBetCandidateFromComputedMarketRow(row, {
        eventId: oddsEvent?.eventId,
        gameId: data?.eventId,
        mode: data?.mode ?? "college",
        sportKey: oddsEvent?.sportKey ?? sportKey,
        eventLabel: `${away?.shortDisplayName ?? "Away"} @ ${home?.shortDisplayName ?? "Home"}`,
        homeTeam: home?.displayName ?? "Home",
        awayTeam: away?.displayName ?? "Away",
      }),
    })),
    [away?.displayName, away?.shortDisplayName, data?.eventId, data?.mode, fliffRows, home?.displayName, home?.shortDisplayName, oddsEvent?.eventId, oddsEvent?.sportKey, sportKey],
  );

  // Book rows for moneyline and spread
  const moneylineRows = useMemo(() => buildBookOddsRows(
    odds,
    "h2h",
    away?.displayName ?? "",
    away?.shortDisplayName ?? "",
    home?.displayName ?? "",
    home?.shortDisplayName ?? "",
  ), [odds, away, home]);

  const spreadRows = useMemo(() => buildBookOddsRows(
    odds,
    "spreads",
    away?.displayName ?? "",
    away?.shortDisplayName ?? "",
    home?.displayName ?? "",
    home?.shortDisplayName ?? "",
  ), [odds, away, home]);

  const availableSectionIds = useMemo(
    () => (isBaseball ? ["overview"] : ["overview", "fliff-lines", "reference-market"]),
    [isBaseball],
  );
  useRegisterInGameSections("betting", availableSectionIds);
  const visibleSectionIds = useMemo(
    () => resolveInGameSectionIds("betting", settingsState.inGame.sectionLayoutsByTab, availableSectionIds).visibleIds,
    [availableSectionIds, settingsState.inGame.sectionLayoutsByTab],
  );

  if (isBaseball) {
    const sectionNodes: Record<string, ReactNode> = {
      overview: (
        <Card key="overview">
          <SectionHeader
            title="Betting Lines"
            subtitle="College baseball odds are not wired into the app yet."
            right={<Pill label="Unavailable" tone="warning" />}
          />
        </Card>
      ),
    };
    return (
      <GameTabScreenScaffold>
        {visibleSectionIds.map((id) => sectionNodes[id] ?? null)}
      </GameTabScreenScaffold>
    );
  }

  const awayName = away?.shortDisplayName || away?.abbreviation || "Away";
  const homeName = home?.shortDisplayName || home?.abbreviation || "Home";

  return (
    <GameTabScreenScaffold refreshing={refreshing} onRefresh={onRefresh}>
      {/* 1. Win probability line chart */}
      {data?.winProbability && data.winProbability.length > 0 ? (
        <Card padded={false}>
          <View style={styles.winProbHeader}>
            <SectionHeader
              title="Win Probability"
              right={<Pill label="Live" tone="success" />}
            />
          </View>
          <View style={styles.winProbChart}>
            <MomentumTopStatsCard
              awayTeam={away ? { id: away.id ?? "away", name: away.displayName ?? "Away", color: away.color ?? "", alternateColor: away.alternateColor } : undefined}
              homeTeam={home ? { id: home.id ?? "home", name: home.displayName ?? "Home", color: home.color ?? "", alternateColor: home.alternateColor } : undefined}
              winProbability={data.winProbability}
              startDateTime={data.meta?.startDateTime}
              status={data.status ? { period: data.status.period ?? 0, displayClock: data.status.displayClock ?? "", state: data.status.state ?? "" } : null}
              isLive={data.status?.state === "in"}
            />
          </View>
        </Card>
      ) : null}

      {/* Error / loading state */}
      {error ? (
        <Card>
          <SectionHeader
            title="Betting Lines"
            right={<Pill label={loading ? "Loading" : "Error"} tone={loading ? "warning" : "danger"} />}
          />
          <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading odds"
            onPress={() => void loadOdds({ force: true })}
            style={[
              styles.retryButton,
              { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[styles.retryButtonText, { color: theme.colors.textPrimary }]}>Retry</Text>
          </Pressable>
        </Card>
      ) : loading && !odds ? (
        // Skeleton shaped like the Moneyline/Spread cards below, instead of
        // a bare "Loading" pill.
        <TabContentSkeleton cards={2} rowsPerCard={3} />
      ) : null}

      {/* 2. Moneyline */}
      {odds ? (
        <OddsMarketCard
          title="Moneyline"
          rows={moneylineRows}
          showPoint={false}
          awayName={awayName}
          homeName={homeName}
          empty="No moneyline data available."
        />
      ) : null}

      {/* 3. Spread */}
      {odds ? (
        <OddsMarketCard
          title="Spread"
          rows={spreadRows}
          showPoint
          awayName={awayName}
          homeName={homeName}
          empty="No spread data available."
        />
      ) : null}

      {/* 4. Pro-EV (Fliff Lines) */}
      {odds ? (
        <Card padded={false}>
          <View style={styles.proEvHeader}>
            <SectionHeader
              title="Pro-EV · Fliff Lines"
              subtitle="Fliff prices vs. sharp reference market"
            />
          </View>
          {fliffRows.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
              No Fliff lines found for this event.
            </Text>
          ) : (
            fliffRows.map((row, i) => (
              <ProEvRow key={`${row.bookKey}-${row.market}-${row.side}-${row.point ?? "na"}-${i}`} row={row} />
            ))
          )}
        </Card>
      ) : null}
    </GameTabScreenScaffold>
  );
}

const styles = StyleSheet.create({
  winProbHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  winProbChart: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  proEvHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 34,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: "800",
  },
});
