import { useEffect, useState } from "react";

import type { PlayerProfileData } from "@/src/features/basketball/playerApi";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { getCachedJson, setCachedJson } from "@/utils/cache";

/**
 * "About" bio for the Player Profile Overview tab. Same OpenAI call shape as
 * the Insights sections and the Apex Article (components/game/
 * PreGamePreviewScreen.tsx, src/features/recap/useGameInsights.ts,
 * src/features/summary/aiGameSummary.tsx) — plain fetch to the chat
 * completions endpoint, one system prompt + one user prompt, no SDK.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

// Weekly refresh, same spirit as the other AI features' regen intervals
// (aiGameSummary's MIN_REGEN_INTERVAL_MS, useGameInsights' LIVE_REFRESH_
// INTERVAL_MS) just scaled up — a player bio doesn't go stale between polls,
// only between games. See buildBioCacheKey: gamesPlayed is baked into the
// key too, so a new game (which is the one thing that can make "notable
// recent performance" stale) invalidates the bio well before a week passes,
// while this TTL keeps repeat screen visits within the same week from
// re-hitting the API for players whose game count hasn't moved.
const BIO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BIO_SYSTEM_PROMPT =
  "You are a neutral basketball scouting analyst. Write a short bio for a player using ONLY the facts provided. " +
  "2-4 sentences, neutral scouting-report tone (not a fan/hype voice). Cover role and playing style, and if the data " +
  "supports it, one standout storyline (a transfer, a breakout season, a notable career-high performance). " +
  "Never invent stats, schools, awards, or biographical details that are not in the provided data — this data source " +
  "does not include high school, so never mention a high school (real or invented) unless one is explicitly given below. " +
  "If a fact (hometown, class year, draft status) is missing, simply omit it rather than guessing. " +
  "If the data marks the player as no longer active on the listed team, do NOT describe them as a current player there — " +
  "use past tense for that team/season (e.g. \"played for...\", \"was with... as of his final season there\") and do not assert what team, league, or level they play at now, since that is not provided. " +
  "Plain prose, no headers or bullet points.";

function safeJoin(parts: Array<string | null | undefined>, separator = ". "): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
}

/**
 * schoolHistorySummary is passed in by the caller (built from the same
 * team-timeline data the Career tab's "School timeline" section renders)
 * rather than recomputed here, so this stays decoupled from that screen's
 * local season-bucket types.
 */
export function buildPlayerBioPrompt(
  profile: PlayerProfileData,
  mode: GameMode,
  schoolHistorySummary: string | null,
): string {
  const player = profile.player;
  const season = profile.season;
  const schoolLabel = mode === "college" ? "School" : "Team";

  const identity = safeJoin([
    `Name: ${player.fullName}`,
    player.position ? `Position: ${player.position}` : null,
    player.displayHeight && player.displayWeight
      ? `Size: ${player.displayHeight}, ${player.displayWeight}`
      : null,
    player.age ? `Age: ${player.age}` : null,
    player.experience ? `Class/experience: ${player.experience}` : null,
    player.birthPlace ? `Hometown: ${player.birthPlace}` : null,
    mode === "nba" && player.college ? `College: ${player.college}` : null,
  ], "\n");

  // Deliberately NOT phrased as "current" when the player is inactive — this
  // data source (see getPlayerProfile/getLeaguePath) is scoped to a single
  // league (college, or WNBA) and never updates once a player leaves it, so
  // an inactive record here means "last known team in this league," not
  // necessarily where they play today. player.active/status come straight
  // from ESPN's own flag for this, not something computed locally.
  const teamLine = player.active
    ? `Current ${schoolLabel.toLowerCase()}: ${player.team.name}${player.team.conferenceName ? ` (${player.team.conferenceName})` : ""}`
    : `${schoolLabel}: ${player.team.name}${player.team.conferenceName ? ` (${player.team.conferenceName})` : ""} — NOTE: this data source lists the player as "${player.status || "inactive"}" here, meaning they are no longer on this roster. Do not describe them as currently playing for this team.`;

  const seasonLine = safeJoin([
    `${season.label} averages: ${season.pointsPerGame?.toFixed(1) ?? "-"} pts, ${season.reboundsPerGame?.toFixed(1) ?? "-"} reb, ${season.assistsPerGame?.toFixed(1) ?? "-"} ast over ${season.gamesPlayed} games`,
    typeof season.fgPct === "number" ? `${season.fgPct.toFixed(1)}% FG` : null,
    typeof season.threePct === "number" ? `${season.threePct.toFixed(1)}% 3PT` : null,
  ], ", ");

  const ratingLine =
    typeof profile.rating.seasonAverage === "number"
      ? `Season Apex Rating average: ${profile.rating.seasonAverage.toFixed(1)}/10`
      : null;

  return safeJoin(
    [
      identity,
      teamLine,
      seasonLine,
      ratingLine,
      schoolHistorySummary ? `Career history: ${schoolHistorySummary}` : null,
      "Write the bio now.",
    ],
    "\n",
  );
}

function buildBioCacheKey(
  mode: GameMode,
  playerId: string,
  gamesPlayed: number,
  active: boolean,
  status: string | null,
): string {
  // active/status are baked into the key (not just gamesPlayed) so a status
  // flip — e.g. a player going from active to inactive on this league's
  // roster — invalidates the cached bio immediately rather than waiting out
  // the weekly TTL. This is exactly the kind of change that makes an old bio
  // actively wrong (confidently describing a stale team as current) rather
  // than just outdated.
  return `player-bio:${mode}:${playerId}:${gamesPlayed}:${active ? "active" : "inactive"}:${status ?? ""}`;
}

async function requestPlayerBio(prompt: string): Promise<string> {
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
      max_tokens: 220,
      temperature: 0.6,
      messages: [
        { role: "system", content: BIO_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Player bio request failed with ${response.status}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Player bio response was empty");
  }
  return content;
}

export type UsePlayerBioResult = {
  bio: string | null;
  loading: boolean;
  unavailable: boolean;
};

export function usePlayerBio(
  profile: PlayerProfileData | null,
  mode: GameMode,
  schoolHistorySummary: string | null,
): UsePlayerBioResult {
  const [bio, setBio] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const playerId = profile?.player.id ?? null;
  const gamesPlayed = profile?.season.gamesPlayed ?? 0;
  const active = profile?.player.active ?? true;
  const status = profile?.player.status ?? null;

  useEffect(() => {
    if (!profile || !playerId) {
      return;
    }

    const cacheKey = buildBioCacheKey(mode, playerId, gamesPlayed, active, status);
    let cancelled = false;

    void (async () => {
      const cached = await getCachedJson<string>(cacheKey);
      if (cached) {
        if (!cancelled) {
          setBio(cached);
          setUnavailable(false);
        }
        return;
      }

      const prompt = buildPlayerBioPrompt(profile, mode, schoolHistorySummary);
      setLoading(true);
      setUnavailable(false);
      try {
        const content = await requestPlayerBio(prompt);
        if (cancelled) {
          return;
        }
        setBio(content);
        setUnavailable(false);
        await setCachedJson(cacheKey, content, BIO_CACHE_TTL_MS);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn("[PlayerBio] bio unavailable", error);
        setUnavailable(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, gamesPlayed, mode, playerId, profile, schoolHistorySummary, status]);

  return { bio, loading, unavailable };
}
