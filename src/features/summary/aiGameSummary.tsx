import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useLiveGame, type LiveGameData, type LiveGamePlayer } from "@/hooks/useLiveGame";
import { buildRecapMoments } from "@/src/features/recap/recapMoments";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const MIN_REGEN_INTERVAL_MS = 60_000;
const RATING_REGEN_DELTA = 0.5;
// Tightened for a short, scannable recap that reads well both on the Summary
// tab and inside the collapsible card on the Plays tab.
const SYSTEM_PROMPT =
  "You are a sharp sports analyst watching a live basketball game. Based on the player rating data provided, write a short, scannable recap of the game so far in 2-3 concise sentences (or 2-3 short bullet points). Focus on who is playing well, momentum shifts, and the single most interesting storyline. Be specific about players and ratings. Keep it brief and skimmable — no long narrative paragraphs.";

// Final-game recap (the Recap tab). One call returns BOTH pieces so a
// completed game doesn't cost two round trips: a punchy editorial one-liner
// and the fuller prose narration underneath it. The strict two-label output
// format is what `parseRecapResponse` splits on.
const RECAP_SYSTEM_PROMPT = [
  "You are a sharp sports editor writing the recap of a basketball game that has just gone final.",
  "Respond with EXACTLY three labelled sections and nothing else:",
  "HEADLINE: a single punchy editorial line, under 120 characters, combining the winner, the final score, and a sharp hook. Example style: \"PHX escapes on the road, 86-82, snapping LA's 3-game win streak\".",
  "RECAP: 2-4 sentences narrating how the game actually unfolded — the hot start, the cold stretch, who took over late, and how it was decided. Be specific about players, runs, and numbers. Confident editorial voice, no hedging, no bullet points.",
  "QUARTERS: one line per period, each starting with that period's exact label followed by a colon (for example \"Q1:\" or \"1H:\"), using ONLY the period labels given in the data. One short sentence each describing what happened in that period. Example: \"Q1: Dallas jumps out 30-19 behind hot 3-point shooting.\" Do not add any period that is not in the data.",
].join("\n");

type SummaryContext = {
  prompt: string;
  ratingSnapshot: Map<string, number>;
};

export type AiGameRecap = {
  /** Punchy one-line result headline for the top of the Recap tab. */
  headline: string;
  /** 2-4 sentence prose narration of how the game unfolded. */
  story: string;
  /** One narrative line per period, in order, for the quarter-by-quarter list. */
  quarters: AiQuarterLine[];
};

export type AiQuarterLine = {
  /** Period label as it appears in the data ("Q1", "1H", "OT", ...). */
  label: string;
  /** The sentence describing that period, with the label prefix stripped. */
  text: string;
};

type AiGameSummaryValue = {
  summary: string | null;
  lastUpdated: Date | null;
  isGenerating: boolean;
  unavailable: boolean;
  isLive: boolean;
  loading: boolean;
  /** Final-game recap; null until the game is post and generation succeeds. */
  recap: AiGameRecap | null;
  isGeneratingRecap: boolean;
  recapUnavailable: boolean;
};

const AiGameSummaryContext = createContext<AiGameSummaryValue | null>(null);

/**
 * Single place the OpenAI call is made from, so the live summary and the
 * final-game recap share identical auth/error handling.
 */
async function requestCompletion(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("missing-api-key");
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI response was empty");
  }
  return content;
}

/**
 * Splits the three-section recap response. Each section is optional at parse
 * time: a formatting slip degrades to "missing that one piece" (the screen
 * hides the section) rather than to a broken screen, and an unlabelled body
 * is treated as the story.
 */
function parseRecapResponse(content: string): AiGameRecap | null {
  const headlineMatch = content.match(/HEADLINE:\s*(.+?)(?:\n|$)/i);
  // RECAP runs until QUARTERS starts (or to the end when it's absent).
  const recapMatch = content.match(/RECAP:\s*([\s\S]+?)(?=\n\s*QUARTERS:|$)/i);
  const quartersMatch = content.match(/QUARTERS:\s*([\s\S]+)$/i);

  const headline = headlineMatch?.[1]?.trim() ?? "";
  const story = (recapMatch?.[1] ?? (headlineMatch ? "" : content)).trim();
  const quarters = parseQuarterLines(quartersMatch?.[1] ?? "");

  if (!headline && !story && quarters.length === 0) {
    return null;
  }
  return { headline, story, quarters };
}

/**
 * Turns the QUARTERS block into label/text pairs. Only lines that actually
 * lead with a "<label>:" prefix are kept — that prefix is what the UI renders
 * as the period chip, and a line without one can't be placed in the list.
 */
function parseQuarterLines(block: string): AiQuarterLine[] {
  // Split on every "<label>:" occurrence rather than on newlines. The model
  // frequently returns the whole block on ONE line ("Q1: ... Q2: ... Q3: ..."),
  // which a newline split collapses into a single entry whose text swallows
  // every other period — that's what made the quarter breakdown render as one
  // dense paragraph instead of a per-period list. Scanning for the label
  // boundaries themselves handles both shapes.
  //
  // The label pattern is deliberately tight (Q1-Q9, 1H/2H, OT/2OT/3OT) so it
  // can't false-positive on a colon inside a sentence.
  const labelPattern = /\b(Q[1-9]|[1-9]H|[1-9]?OT)\s*:\s*/gi;
  const entries: AiQuarterLine[] = [];
  const matches = [...block.matchAll(labelPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? block.length : block.length;
    const text = block
      .slice(start, end)
      // Trim the bullet/dash/whitespace that leads the NEXT line off the tail
      // of this one.
      .replace(/[\s\-*•]+$/, "")
      .trim();
    if (text) {
      entries.push({ label: match[1].toUpperCase(), text });
    }
  }

  return entries;
}

/**
 * Generates the AI game summary once and shares it with every consumer (the
 * Summary tab and the collapsible card on the Plays tab), so the generation
 * logic lives in a single place and the API is only called once.
 */
export function AiGameSummaryProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useLiveGame();
  const [summary, setSummary] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const previousRatingsRef = useRef<Map<string, number>>(new Map());
  const lastRequestAtRef = useRef(0);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const context = useMemo(() => buildSummaryContext(data), [data]);
  const isLive = data?.status.state === "in";

  const [recap, setRecap] = useState<AiGameRecap | null>(null);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [recapUnavailable, setRecapUnavailable] = useState(false);
  // Guards against re-requesting the recap on every poll once a game is
  // final. Keyed by game id so navigating to a different finished game still
  // generates its own recap.
  const recapRequestedForGameRef = useRef<string | null>(null);
  const isFinal = data?.status.state === "post";
  const recapPrompt = useMemo(
    () => (isFinal ? buildRecapPrompt(data) : null),
    [data, isFinal],
  );

  const generateSummary = useCallback(async (nextContext: SummaryContext) => {
    setIsGenerating(true);
    setUnavailable(false);
    lastRequestAtRef.current = Date.now();

    try {
      const content = await requestCompletion(SYSTEM_PROMPT, nextContext.prompt, 160);
      previousRatingsRef.current = nextContext.ratingSnapshot;
      setSummary(content);
      setLastUpdated(new Date());
      setUnavailable(false);
    } catch (error) {
      console.warn("[AiGameSummary] summary unavailable", error);
      setUnavailable(true);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (!context) {
      return;
    }

    const shouldGenerate =
      !summary || hasRatingMovedEnough(previousRatingsRef.current, context.ratingSnapshot);
    if (!shouldGenerate) {
      return;
    }

    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }

    const elapsed = Date.now() - lastRequestAtRef.current;
    if (elapsed >= MIN_REGEN_INTERVAL_MS || !summary) {
      void generateSummary(context);
      return;
    }

    pendingTimeoutRef.current = setTimeout(() => {
      void generateSummary(context);
    }, MIN_REGEN_INTERVAL_MS - elapsed);

    return () => {
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
    };
  }, [context, generateSummary, summary]);

  // Final-game recap: generated once per finished game (see
  // recapRequestedForGameRef) rather than on the live summary's polling
  // cadence — a final score can't change, so there's nothing to refresh.
  useEffect(() => {
    const gameKey = data?.eventId ?? null;
    if (!isFinal || !recapPrompt || !gameKey) {
      return;
    }
    if (recapRequestedForGameRef.current === gameKey) {
      return;
    }
    recapRequestedForGameRef.current = gameKey;

    let cancelled = false;
    setIsGeneratingRecap(true);
    setRecapUnavailable(false);

    void (async () => {
      try {
        // Headroom for all three sections (headline + prose + one line per
        // period, including overtimes) — a truncated response loses the
        // QUARTERS block entirely, since it comes last.
        const content = await requestCompletion(RECAP_SYSTEM_PROMPT, recapPrompt, 550);
        const parsed = parseRecapResponse(content);
        if (cancelled) {
          return;
        }
        if (!parsed) {
          throw new Error("recap response could not be parsed");
        }
        setRecap(parsed);
        setRecapUnavailable(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn("[AiGameSummary] recap unavailable", error);
        setRecapUnavailable(true);
        // Allow a retry on the next poll rather than latching failure for the
        // rest of the session.
        recapRequestedForGameRef.current = null;
      } finally {
        if (!cancelled) {
          setIsGeneratingRecap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.eventId, isFinal, recapPrompt]);

  const value = useMemo<AiGameSummaryValue>(
    () => ({
      summary,
      lastUpdated,
      isGenerating,
      unavailable,
      isLive: Boolean(isLive),
      loading,
      recap,
      isGeneratingRecap,
      recapUnavailable,
    }),
    [
      summary,
      lastUpdated,
      isGenerating,
      unavailable,
      isLive,
      loading,
      recap,
      isGeneratingRecap,
      recapUnavailable,
    ],
  );

  return (
    <AiGameSummaryContext.Provider value={value}>{children}</AiGameSummaryContext.Provider>
  );
}

export function useAiGameSummary(): AiGameSummaryValue {
  const context = useContext(AiGameSummaryContext);
  if (!context) {
    throw new Error("useAiGameSummary must be used within AiGameSummaryProvider");
  }
  return context;
}

function buildSummaryContext(data: LiveGameData | null): SummaryContext | null {
  if (!data) {
    return null;
  }

  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const players = Object.values(data.playersByTeam ?? {}).flat();
  const topPlayers = players
    .filter((player) => typeof player.inGameRating10 === "number")
    .sort((left, right) => {
      const ratingDiff = (right.inGameRating10 ?? 0) - (left.inGameRating10 ?? 0);
      if (ratingDiff !== 0) {
        return ratingDiff;
      }
      return right.points - left.points;
    })
    .slice(0, 5);
  const ratingSnapshot = buildRatingSnapshot(players);
  const meaningfulEvents = collectMeaningfulEvents(players);
  const statusText = getGameStatusText(data);
  const scoreText =
    away && home
      ? `${away.shortDisplayName || away.displayName} ${away.score || "-"}, ${home.shortDisplayName || home.displayName} ${home.score || "-"}`
      : "Score unavailable";

  const prompt = [
    `Current score: ${scoreText}`,
    `Period and clock: ${data.status.periodLabel || `Period ${data.status.period}`} ${data.status.displayClock || ""}`.trim(),
    `Game status: ${statusText}`,
    "Top 5 players by current rating:",
    topPlayers.length
      ? topPlayers.map(formatPlayerForPrompt).join("\n")
      : "No rated players yet.",
    "Last 3 meaningful rating events:",
    meaningfulEvents.length
      ? meaningfulEvents.join("\n")
      : "No meaningful rating events yet.",
  ].join("\n");

  return { prompt, ratingSnapshot };
}

/**
 * Prompt for the final-game recap. Richer than the live summary's: it carries
 * the final score, the per-period linescores (so the model can talk about a
 * hot start or a cold third), the top performers on BOTH teams, and the
 * derived biggest moments — everything the Recap tab itself shows.
 */
function buildRecapPrompt(data: LiveGameData | null): string | null {
  if (!data) {
    return null;
  }
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  if (!away || !home) {
    return null;
  }

  const awayName = away.shortDisplayName || away.displayName;
  const homeName = home.shortDisplayName || home.displayName;
  const awayScore = Number.parseInt(away.score, 10) || 0;
  const homeScore = Number.parseInt(home.score, 10) || 0;
  const winner = awayScore === homeScore ? null : awayScore > homeScore ? away : home;
  const loser = winner ? (winner === away ? home : away) : null;

  const players = Object.values(data.playersByTeam ?? {}).flat();
  const topPlayers = players
    .filter((player) => typeof player.inGameRating10 === "number")
    .sort((left, right) => {
      const ratingDiff = (right.inGameRating10 ?? 0) - (left.inGameRating10 ?? 0);
      return ratingDiff !== 0 ? ratingDiff : right.points - left.points;
    })
    .slice(0, 6);

  const moments = buildRecapMoments(data);

  return [
    `FINAL: ${awayName} ${awayScore}, ${homeName} ${homeScore}`,
    winner && loser
      ? `Winner: ${winner.shortDisplayName || winner.displayName} (${winner.record || "record n/a"}). Loser: ${loser.shortDisplayName || loser.displayName} (${loser.record || "record n/a"}).`
      : "Result: tie.",
    away.linescores?.length ? `${awayName} by period: ${away.linescores.join(", ")}` : "",
    home.linescores?.length ? `${homeName} by period: ${home.linescores.join(", ")}` : "",
    buildPeriodBreakdownForPrompt(data, awayName, homeName),
    "Top performers (both teams, by rating):",
    topPlayers.length
      ? topPlayers.map(formatPlayerForPrompt).join("\n")
      : "No rated players.",
    moments.length
      ? `Key moments:\n${moments.map((moment) => `- ${moment.label} (${moment.detail})`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Per-period scoring plus a couple of that period's biggest plays, so the
 * QUARTERS narrative can be specific ("behind hot 3-point shooting") rather
 * than just restating the linescore. Also pins the exact period labels the
 * model is allowed to use.
 */
function buildPeriodBreakdownForPrompt(
  data: LiveGameData,
  awayName: string,
  homeName: string,
): string {
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const periodCount = Math.max(
    away?.linescores?.length ?? 0,
    home?.linescores?.length ?? 0,
  );
  if (periodCount === 0) {
    return "";
  }
  // Halves (2 columns) vs quarters — matches the Stats/Recap tabs' convention.
  const regulation = periodCount <= 2 ? 2 : 4;
  const labelFor = (index: number): string => {
    if (index < regulation) {
      return regulation === 2 ? ["1H", "2H"][index] ?? `H${index + 1}` : `Q${index + 1}`;
    }
    const ot = index - regulation + 1;
    return ot === 1 ? "OT" : `${ot}OT`;
  };

  // Group scoring plays by their period label so each line can cite real plays.
  const playsByLabel = new Map<string, string[]>();
  for (const play of data.plays ?? []) {
    if (!play.scoringPlay || !play.text) {
      continue;
    }
    const key = (play.period || "").trim().toUpperCase();
    if (!key) {
      continue;
    }
    const bucket = playsByLabel.get(key) ?? [];
    if (bucket.length < 3) {
      bucket.push(play.text);
      playsByLabel.set(key, bucket);
    }
  }

  const lines = Array.from({ length: periodCount }, (_, index) => {
    const label = labelFor(index);
    const awayPts = away?.linescores?.[index] ?? "0";
    const homePts = home?.linescores?.[index] ?? "0";
    const notable = playsByLabel.get(label.toUpperCase()) ?? [];
    const notableText = notable.length ? ` Notable: ${notable.join("; ")}` : "";
    return `- ${label}: ${awayName} ${awayPts}, ${homeName} ${homePts}.${notableText}`;
  });

  return [
    `Period labels to use, in order: ${Array.from({ length: periodCount }, (_, i) => labelFor(i)).join(", ")}`,
    "Per-period breakdown:",
    ...lines,
  ].join("\n");
}

function formatPlayerForPrompt(player: LiveGamePlayer): string {
  const rating =
    typeof player.inGameRating10 === "number"
      ? player.inGameRating10.toFixed(1)
      : "-";
  return `- ${player.name}: ${rating} rating, ${player.points} pts, ${player.rebounds} reb, ${player.assists} ast`;
}

function collectMeaningfulEvents(players: LiveGamePlayer[]): string[] {
  const byKey = new Map<string, string>();
  const events = players
    .flatMap((player) =>
      (player.ratingTimelinePoints ?? [])
        .filter((point) => point.description && typeof point.delta === "number")
        .map((point) => ({
          key: point.eventId ?? `${player.id}:${point.tSec}:${point.description}`,
          tSec: point.tSec,
          text: `- ${player.name}: ${point.description} (${formatRating(point.ratingBefore)} to ${formatRating(point.ratingAfter)}, ${formatDelta(point.delta)})`,
        })),
    )
    .sort((left, right) => right.tSec - left.tSec);

  events.forEach((event) => {
    if (!byKey.has(event.key)) {
      byKey.set(event.key, event.text);
    }
  });

  return [...byKey.values()].slice(0, 3);
}

function buildRatingSnapshot(players: LiveGamePlayer[]): Map<string, number> {
  return new Map(
    players
      .filter((player) => typeof player.inGameRating10 === "number")
      .map((player) => [player.id, player.inGameRating10 ?? 0]),
  );
}

function hasRatingMovedEnough(previous: Map<string, number>, next: Map<string, number>): boolean {
  for (const [playerId, rating] of next) {
    const previousRating = previous.get(playerId);
    if (typeof previousRating !== "number") {
      return true;
    }
    if (Math.abs(rating - previousRating) >= RATING_REGEN_DELTA) {
      return true;
    }
  }
  return false;
}

function getGameStatusText(data: LiveGameData): string {
  const detail = data.status.shortDetail || data.status.detail || data.status.description;
  if (data.status.state === "post") {
    return `final${detail ? ` - ${detail}` : ""}`;
  }
  if (/half/i.test(detail)) {
    return `halftime${detail ? ` - ${detail}` : ""}`;
  }
  if (data.status.state === "in") {
    return `live${detail ? ` - ${detail}` : ""}`;
  }
  return detail || data.status.state || "unknown";
}

function formatRating(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}

function formatDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0.0";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
