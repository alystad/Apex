import type { SettingsState } from "@/src/settings/settingsTypes";
import type { GameMode } from "@/src/mode/gameModeTypes";
import type { InGameRouteKey } from "@/src/ui/inGameRoutes";

export type InGameTabItem = {
  key: InGameRouteKey;
  label: string;
  route: `/(tabs)/${string}`;
};

export type InGameTabLayout = {
  order: InGameRouteKey[];
  hidden: InGameRouteKey[];
};

export const PREVIEW_TAB_ITEM: InGameTabItem = {
  key: "preview",
  label: "Preview",
  route: "/(tabs)/preview",
};

export const BASE_IN_GAME_TAB_ITEMS: readonly InGameTabItem[] = [
  { key: "betting", label: "Odds", route: "/(tabs)/betting" },
  { key: "live", label: "Court", route: "/(tabs)/live" },
  { key: "team-stats", label: "Stats", route: "/(tabs)/team-stats" },
  { key: "playbyplay", label: "Plays", route: "/(tabs)/playbyplay" },
] as const;

const DEFAULT_IN_GAME_TAB_ORDER = BASE_IN_GAME_TAB_ITEMS.map((item) => item.key);

const DEFAULT_TAB_ROUTE_MAP: Record<
  SettingsState["inGame"]["defaultTab"],
  InGameRouteKey
> = {
  court: "live",
  stats: "team-stats",
  commentary: "playbyplay",
};

function uniqueTabKeys(keys: readonly InGameRouteKey[]): InGameRouteKey[] {
  return keys.filter((key, index, all) => all.indexOf(key) === index);
}

function isInGameRouteKey(value: unknown): value is InGameRouteKey {
  return BASE_IN_GAME_TAB_ITEMS.some((item) => item.key === value);
}

export function getDefaultInGameTabLayout(): InGameTabLayout {
  return {
    order: [...DEFAULT_IN_GAME_TAB_ORDER],
    hidden: [],
  };
}

export function sanitizeInGameTabLayout(value: unknown): InGameTabLayout {
  const defaults = getDefaultInGameTabLayout();
  const raw = (value ?? {}) as Partial<InGameTabLayout>;
  const order = Array.isArray(raw.order)
    ? uniqueTabKeys(
        raw.order.filter((item): item is InGameRouteKey => isInGameRouteKey(item)),
      )
    : [];
  const hidden = Array.isArray(raw.hidden)
    ? uniqueTabKeys(
        raw.hidden.filter((item): item is InGameRouteKey => isInGameRouteKey(item)),
      )
    : [];

  const repairedOrder = [...order];
  defaults.order.forEach((key) => {
    if (!repairedOrder.includes(key)) {
      repairedOrder.push(key);
    }
  });

  const hiddenSet = new Set(hidden.filter((key) => repairedOrder.includes(key)));
  if (repairedOrder.every((key) => hiddenSet.has(key))) {
    hiddenSet.delete(repairedOrder.find((key) => key === "live") ?? repairedOrder[0]);
  }

  return {
    order: repairedOrder,
    hidden: repairedOrder.filter((key) => hiddenSet.has(key)),
  };
}

export function getOrderedInGameTabItems(settings: SettingsState): InGameTabItem[] {
  const layout = sanitizeInGameTabLayout(settings.inGame.tabLayout);
  return layout.order
    .map((key) => BASE_IN_GAME_TAB_ITEMS.find((item) => item.key === key))
    .filter((item): item is InGameTabItem => Boolean(item));
}

export function getVisibleInGameTabItems(
  settings: SettingsState,
  _mode?: GameMode,
): InGameTabItem[] {
  const layout = sanitizeInGameTabLayout(settings.inGame.tabLayout);
  const hidden = new Set(layout.hidden);
  return getOrderedInGameTabItems(settings).filter((item) => !hidden.has(item.key));
}

export function getResolvedDefaultInGameTab(
  settings: SettingsState,
  mode?: GameMode,
): InGameTabItem {
  const visibleTabs = getVisibleInGameTabItems(settings, mode);
  const preferredKey = DEFAULT_TAB_ROUTE_MAP[settings.inGame.defaultTab];
  const preferredTab = visibleTabs.find((item) => item.key === preferredKey);

  if (preferredTab) {
    return preferredTab;
  }

  const courtTab = visibleTabs.find((item) => item.key === "live");
  if (courtTab) {
    return courtTab;
  }

  return visibleTabs[0] ?? BASE_IN_GAME_TAB_ITEMS[1];
}

export function getActiveInGameTab(
  pathname: string,
  items: readonly InGameTabItem[],
): InGameRouteKey {
  return (
    items.find(
      (item) =>
        pathname === item.route ||
        pathname === `/${item.key}` ||
        pathname.endsWith(`/${item.key}`),
    )?.key ?? items[0]?.key ?? "live"
  );
}
