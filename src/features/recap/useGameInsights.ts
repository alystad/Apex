import { useEffect, useRef, useState } from "react";

import type { LiveGameData, LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";

/**
 * Insights for the LIVE and RECAP states of the story tab.
 *
 * Modeled on the Preview tab's insights (components/game/PreGamePreviewScreen.tsx)
 * — same per-team, three-bullets-each shape and the same "don't repeat what's
 * already on screen" instruction — but implemented separately and deliberately
 * NOT shared with it: the Preview version is pregame-only and is left exactly
 * as-is. The difference here is tense and source material. Live insights are
 * about what's happening right now and what it's on pace for; Recap insights
 * are retrospective and settled.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
// Live insights go stale as the game moves; refresh on a slow cadence so the
// section stays current without hammering the API on every poll.
const LIVE_REFRESH_INTERVAL_MS = 180_000;

export type GameInsightsPhase = "live" | "recap";

export type TeamGameInsights = {
  away: string[];
  home: string[];
};

const EMPTY_INSIGHTS: TeamGameInsights = { away: [], home: [] };

const LIVE_SYSTEM_PROMPT =
  "You are a sharp basketball analyst watching a game in progress. Produce short, concrete, present-tense insights about what is happening RIGHT NOW and what the game is on pace for. " +
  "Favour season/franchise context (largest lead of their season, on pace for a season high in threes, unusual rotation or foul trouble, a player well above his season averages). " +
  "Each insight is ONE concise factual sentence. Never invent specific numbers you were not given.";

const RECAP_SYSTEM_PROMPT =
  "You are a sharp basketball analyst writing after a game has finished. Produce short, concrete, past-tense retrospective insights about what the final result means. " +
  "Favour season/franchise context (their largest comeback win this season, tied a season high in threes, a career-best night, what the result does to their standing or streak). " +
  "Each insight is ONE concise factual sentence. Never invent specific numbers you were not given.";

function teamLabel(team: LiveGameTeam | undefined): string {
  return team?.shortDisplayName || team?.displayName || team?.abbreviation || "Team";
}

function formatTopPlayers(players: LiveGamePlayer[]): string {
  const top = [...players]
    .filter((player) => !player.didNotPlay)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 3);
  if (top.length === 0) {
    return "no player stats yet";
  }
  return top
    .map(
      (player) =>
        `${player.name} ${player.points ?? 0}p/${player.rebounds ?? 0}r/${player.assists ?? 0}a` +
        (player.threePt ? ` (${player.threePt} 3PT)` : ""),
    )
    .join("; ");
}

function buildContext(data: LiveGameData, phase: GameInsightsPhase): string | null {
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  if (!away || !home) {
    return null;
  }

  const awayName = teamLabel(away);
  const homeName = teamLabel(home);
  const awayRoster = data.playersByTeam?.[away.id] ?? [];
  const homeRoster = data.playersByTeam?.[home.id] ?? [];

  const statusLine =
    phase === "live"
      ? `IN PROGRESS — ${data.status?.periodLabel || `Period ${data.status?.period ?? ""}`} ${data.status?.displayClock || ""}`.trim()
      : "FINAL";

  return [
    `${statusLine}. ${awayName} ${away.score || 0}, ${homeName} ${home.score || 0}.`,
    `Records: ${awayName} ${away.record || "n/a"}, ${homeName} ${home.record || "n/a"}.`,
    away.linescores?.length ? `${awayName} by period: ${away.linescores.join(", ")}` : "",
    home.linescores?.length ? `${homeName} by period: ${home.linescores.join(", ")}` : "",
    `${awayName} team totals: ${away.totals?.fg || "?"} FG, ${away.totals?.threePt || "?"} 3PT, ${away.totals?.ft || "?"} FT, ${away.totals?.rebounds || "?"} reb, ${away.totals?.assists || "?"} ast, ${away.totals?.turnovers || "?"} TO, ${away.totals?.benchPoints || "?"} bench pts.`,
    `${homeName} team totals: ${home.totals?.fg || "?"} FG, ${home.totals?.threePt || "?"} 3PT, ${home.totals?.ft || "?"} FT, ${home.totals?.rebounds || "?"} reb, ${home.totals?.assists || "?"} ast, ${home.totals?.turnovers || "?"} TO, ${home.totals?.benchPoints || "?"} bench pts.`,
    `${awayName} leaders: ${formatTopPlayers(awayRoster)}`,
    `${homeName} leaders: ${formatTopPlayers(homeRoster)}`,
    `Already displayed to the user (DO NOT repeat any of these): the score and period; score by period; bench vs starters points; ` +
      `the biggest run and largest lead; top performers by rating; point differential over time.`,
    `Return ONLY JSON of the form {"away":["...","...","..."],"home":["...","...","..."]} with EXACTLY 3 insights per team.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseInsightsJson(content: string): TeamGameInsights | null {
  // Models often wrap JSON in prose or a ```json fence — pull the outermost
  // object out rather than trusting the whole body to parse.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<TeamGameInsights>;
    const clean = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
    const away = clean(parsed.away);
    const home = clean(parsed.home);
    if (away.length === 0 && home.length === 0) {
      return null;
    }
    return { away, home };
  } catch {
    return null;
  }
}

export type UseGameInsightsResult = {
  insights: TeamGameInsights;
  loading: boolean;
  unavailable: boolean;
};

export function useGameInsights(
  data: LiveGameData | null,
  phase: GameInsightsPhase,
): UseGameInsightsResult {
  const [insights, setInsights] = useState<TeamGameInsights>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Identity of the request already satisfied, so a poll that changes nothing
  // relevant doesn't trigger a regeneration.
  const lastRequestKeyRef = useRef<string | null>(null);
  const lastRequestAtRef = useRef(0);

  const eventId = data?.eventId ?? null;
  const awayScore = data?.teams?.find((team) => team.homeAway === "away")?.score ?? "";
  const homeScore = data?.teams?.find((team) => team.homeAway === "home")?.score ?? "";

  useEffect(() => {
    if (!data || !eventId) {
      return;
    }

    // Recap is generated exactly once per finished game (nothing can change
    // after the final buzzer). Live refreshes on a slow timer.
    const requestKey =
      phase === "recap"
        ? `recap:${eventId}`
        : `live:${eventId}:${Math.floor(Date.now() / LIVE_REFRESH_INTERVAL_MS)}`;

    if (lastRequestKeyRef.current === requestKey) {
      return;
    }
    if (
      phase === "live" &&
      Date.now() - lastRequestAtRef.current < LIVE_REFRESH_INTERVAL_MS &&
      lastRequestKeyRef.current !== null
    ) {
      return;
    }

    const context = buildContext(data, phase);
    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
    if (!context || !apiKey) {
      setUnavailable(true);
      return;
    }

    lastRequestKeyRef.current = requestKey;
    lastRequestAtRef.current = Date.now();

    let cancelled = false;
    setLoading(true);
    setUnavailable(false);

    void (async () => {
      try {
        const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            max_tokens: 500,
            temperature: 0.7,
            messages: [
              {
                role: "system",
                content: phase === "live" ? LIVE_SYSTEM_PROMPT : RECAP_SYSTEM_PROMPT,
              },
              { role: "user", content: context },
            ],
          }),
        });

        if (!response.ok) {
          throw new Error(`Insights request failed with ${response.status}`);
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const parsed = parseInsightsJson(json.choices?.[0]?.message?.content?.trim() ?? "");
        if (cancelled) {
          return;
        }
        if (!parsed) {
          throw new Error("Insights response could not be parsed");
        }
        setInsights(parsed);
        setUnavailable(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn(`[GameInsights:${phase}] insights unavailable`, error);
        setUnavailable(true);
        // Allow a retry rather than latching failure for the session.
        lastRequestKeyRef.current = null;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // awayScore/homeScore are included so a live game that actually moves can
    // re-evaluate the interval gate above; the gate itself prevents this from
    // turning into a request per poll.
  }, [awayScore, data, eventId, homeScore, phase]);

  return { insights, loading, unavailable };
}
