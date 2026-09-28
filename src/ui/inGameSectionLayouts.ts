import type { InGameRouteKey } from "@/src/ui/inGameRoutes";

export type InGameSectionDefinition = {
  id: string;
  label: string;
};

export type InGameSectionLayout = {
  order: string[];
  hidden: string[];
};

export type InGameSectionLayoutsByTab = Partial<
  Record<InGameRouteKey, InGameSectionLayout>
>;

export const IN_GAME_SECTION_DEFINITIONS: Record<
  InGameRouteKey,
  readonly InGameSectionDefinition[]
> = {
  preview: [],
  live: [
    { id: "prediction", label: "Prediction" },
    { id: "court", label: "Court" },
    { id: "field-status", label: "Field Status" },
    { id: "field-error", label: "Field Error" },
    { id: "live-impact", label: "Last Player Impact" },
    { id: "momentum", label: "Momentum" },
    { id: "top-players", label: "King of the Court" },
  ],
  "team-stats": [
    { id: "point-differential", label: "Point Differential" },
    { id: "score-by-half", label: "Score by Half" },
    { id: "comparison", label: "Team Comparison" },
    { id: "biggest-leads", label: "Biggest Leads" },
    { id: "runs", label: "Runs" },
    { id: "player-streaks", label: "Best Player Streaks" },
  ],
  betting: [
    { id: "overview", label: "Betting Overview" },
    { id: "fliff-lines", label: "Fliff Lines" },
    { id: "reference-market", label: "Reference Market" },
  ],
  playbyplay: [
    { id: "commentary", label: "Plays" },
  ],
  comments: [
    { id: "comments", label: "Comments" },
  ],
};

function uniqueIds(ids: readonly string[]): string[] {
  return ids.filter((id, index, all) => all.indexOf(id) === index);
}

export function getInGameSectionDefinitions(
  tabKey: InGameRouteKey,
): readonly InGameSectionDefinition[] {
  return IN_GAME_SECTION_DEFINITIONS[tabKey] ?? [];
}

export function getInGameSectionDefinitionMap(
  tabKey: InGameRouteKey,
): Map<string, InGameSectionDefinition> {
  return new Map(
    getInGameSectionDefinitions(tabKey).map((definition) => [definition.id, definition]),
  );
}

export function getDefaultInGameSectionLayout(
  tabKey: InGameRouteKey,
): InGameSectionLayout {
  return {
    order: getInGameSectionDefinitions(tabKey).map((definition) => definition.id),
    hidden: [],
  };
}

export function sanitizeInGameSectionLayout(
  tabKey: InGameRouteKey,
  value: unknown,
): InGameSectionLayout {
  const defaultLayout = getDefaultInGameSectionLayout(tabKey);
  const validIds = new Set(defaultLayout.order);
  const raw = (value ?? {}) as Partial<InGameSectionLayout>;
  const order = Array.isArray(raw.order)
    ? uniqueIds(raw.order.filter((item): item is string => typeof item === "string"))
        .filter((id) => validIds.has(id))
    : [];
  const hidden = Array.isArray(raw.hidden)
    ? uniqueIds(raw.hidden.filter((item): item is string => typeof item === "string"))
        .filter((id) => validIds.has(id))
    : [];

  const repairedOrder = [...order];
  defaultLayout.order.forEach((id) => {
    if (!repairedOrder.includes(id)) {
      repairedOrder.push(id);
    }
  });

  return {
    order: repairedOrder,
    hidden,
  };
}

export function sanitizeInGameSectionLayoutsByTab(
  value: unknown,
): InGameSectionLayoutsByTab {
  const raw = (value ?? {}) as Record<string, unknown>;
  const next: InGameSectionLayoutsByTab = {};

  (Object.keys(IN_GAME_SECTION_DEFINITIONS) as InGameRouteKey[]).forEach((tabKey) => {
    if (!(tabKey in raw)) {
      return;
    }
    next[tabKey] = sanitizeInGameSectionLayout(tabKey, raw[tabKey]);
  });

  return next;
}

export function resolveInGameSectionIds(
  tabKey: InGameRouteKey,
  layoutsByTab: InGameSectionLayoutsByTab | undefined,
  availableIds?: readonly string[],
): {
  orderedIds: string[];
  visibleIds: string[];
  hiddenIds: string[];
} {
  const sanitized = sanitizeInGameSectionLayout(tabKey, layoutsByTab?.[tabKey]);
  const allowedIds = new Set(
    uniqueIds(
      (availableIds && availableIds.length > 0
        ? availableIds
        : getDefaultInGameSectionLayout(tabKey).order) as readonly string[],
    ),
  );

  const orderedIds = sanitized.order.filter((id) => allowedIds.has(id));
  const hiddenIds = sanitized.hidden.filter((id) => allowedIds.has(id));
  const visibleIds = orderedIds.filter((id) => !hiddenIds.includes(id));

  return {
    orderedIds,
    visibleIds,
    hiddenIds,
  };
}
