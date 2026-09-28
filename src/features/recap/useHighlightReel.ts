import { useEffect, useMemo, useRef, useState } from "react";

import type { LiveGameData } from "@/hooks/useLiveGame";
import {
  buildHighlightClusters,
  type HighlightCluster,
} from "@/src/features/recap/highlightReel";

/**
 * Narrated highlight reel for the Live and Recap states of the story tab.
 *
 * Clusters are detected deterministically offline (see highlightReel.ts); the
 * model's only job is to put 1-3 sentences of prose around clusters that were
 * already identified from real plays, so it can't invent moments.
 *
 * Narration is INCREMENTAL and cached by cluster id: once a moment has been
 * narrated it is never re-sent, so a live game only ever pays for the new
 * clusters each poll surfaces, and existing entries never re-word themselves
 * underneath the reader.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
// Cap per request so a full game's backlog is narrated in bounded batches.
const MAX_CLUSTERS_PER_REQUEST = 12;

const SYSTEM_PROMPT = [
  "You write one-line basketball highlights for a fast-scanning feed.",
  "You will be given numbered moments, each with factual play data already extracted from the game.",
  "For EACH moment, write exactly ONE short, punchy past-tense sentence — under 20 words.",
  "Capture only the single most notable thing about the moment. Do NOT recount every play in the sequence.",
  "Do not restate the clock or period — the app displays those separately.",
  "Use only the facts given. Never invent players, scores, or events that are not in the data.",
  'Respond with ONLY a JSON object of the form {"1":"...","2":"..."} keyed by the moment number, one entry per moment given.',
].join("\n");

export type Highlight = {
  id: string;
  kind: HighlightCluster["kind"];
  period: string;
  clock: string;
  order: number;
  playIds: string[];
  /** Narrated prose. */
  text: string;
  /** Which team this moment belongs to — see HighlightCluster's own doc. */
  teamId: string | null;
};

export type UseHighlightReelResult = {
  highlights: Highlight[];
  loading: boolean;
  unavailable: boolean;
};

/**
 * Enforces the one-sentence rule client-side. The prompt asks for a single
 * sentence, but a model that returns two would break the compact feed layout,
 * so the extra clauses are dropped rather than trusted.
 *
 * A sentence end is punctuation that BOTH follows a lowercase letter, digit or
 * closing bracket AND is followed by a capital or the end of the string. The
 * first half is what stops an initial ("J. Smith" → the "." follows a capital
 * "J", so it isn't an ending); the second stops a decimal ("3.5"). Written
 * without lookbehind, which Hermes doesn't reliably support.
 *
 * When nothing matches — e.g. a sentence ending on an acronym ("...for DAL.")
 * — the whole string is returned. Failing toward "keep everything" is the
 * right direction: an over-long entry is a layout nit, a truncated one loses
 * information.
 */
function toSingleSentence(value: string): string {
  const match = value.match(/^.*?[a-z0-9)\]"'][.!?](?=\s+[A-Z]|\s*$)/s);
  const first = (match?.[0] ?? value).trim();
  return first || value;
}

function parseNarrationJson(content: string): Record<string, string> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        result[key] = toSingleSentence(value.trim());
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function useHighlightReel(data: LiveGameData | null): UseHighlightReelResult {
  const clusters = useMemo(() => buildHighlightClusters(data), [data]);
  // clusterId -> narrated prose. Persisted across polls so a live feed only
  // grows and never re-words what the reader has already seen.
  const [narrations, setNarrations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Clusters already sent (whether or not they came back), so a failed or
  // in-flight batch isn't re-requested on the very next poll.
  const requestedIdsRef = useRef<Set<string>>(new Set());
  const eventIdRef = useRef<string | null>(null);

  const eventId = data?.eventId ?? null;

  // Switching games resets the cache — otherwise one game's reel would leak
  // into the next.
  useEffect(() => {
    if (eventIdRef.current !== eventId) {
      eventIdRef.current = eventId;
      requestedIdsRef.current = new Set();
      setNarrations({});
      setUnavailable(false);
    }
  }, [eventId]);

  const pendingIds = useMemo(
    () =>
      clusters
        .filter((cluster) => !requestedIdsRef.current.has(cluster.id))
        .map((cluster) => cluster.id)
        .join(","),
    [clusters],
  );

  useEffect(() => {
    if (!pendingIds) {
      return;
    }
    const pending = clusters
      .filter((cluster) => !requestedIdsRef.current.has(cluster.id))
      .slice(0, MAX_CLUSTERS_PER_REQUEST);
    if (pending.length === 0) {
      return;
    }

    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
    if (!apiKey) {
      setUnavailable(true);
      return;
    }

    pending.forEach((cluster) => requestedIdsRef.current.add(cluster.id));

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const prompt = pending
          .map((cluster, index) => `${index + 1}. [${cluster.kind}] ${cluster.facts}`)
          .join("\n");

        const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            // One sub-20-word sentence per moment, so the old 900-token budget
            // (sized for 1-2 sentence narration) is far more than needed.
            max_tokens: 420,
            temperature: 0.6,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
          }),
        });

        if (!response.ok) {
          throw new Error(`Highlights request failed with ${response.status}`);
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const parsed = parseNarrationJson(json.choices?.[0]?.message?.content?.trim() ?? "");
        if (cancelled) {
          return;
        }
        if (!parsed) {
          throw new Error("Highlights response could not be parsed");
        }

        setNarrations((previous) => {
          const next = { ...previous };
          pending.forEach((cluster, index) => {
            const text = parsed[String(index + 1)];
            if (text) {
              next[cluster.id] = text;
            }
          });
          return next;
        });
        setUnavailable(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn("[HighlightReel] narration unavailable", error);
        setUnavailable(true);
        // Let this batch be retried on a later poll rather than losing the
        // moments permanently.
        pending.forEach((cluster) => requestedIdsRef.current.delete(cluster.id));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clusters, pendingIds]);

  const highlights = useMemo(
    () =>
      clusters
        .filter((cluster) => Boolean(narrations[cluster.id]))
        .map((cluster) => ({
          id: cluster.id,
          kind: cluster.kind,
          period: cluster.period,
          clock: cluster.clock,
          order: cluster.order,
          playIds: cluster.playIds,
          text: narrations[cluster.id],
          teamId: cluster.teamId,
        })),
    [clusters, narrations],
  );

  return {
    highlights,
    // Only surface "loading" while there is nothing to show yet; once entries
    // exist, later batches fill in behind the scenes.
    loading: loading && highlights.length === 0,
    unavailable: unavailable && highlights.length === 0,
  };
}
