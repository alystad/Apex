import type {
  LoadingSectionSnapshot,
  LoadingScreenSnapshot,
  LoadingState,
  LoadingTaskInput,
  LoadingTaskRecord,
  LoadingTier,
} from "@/src/loading/loadingTypes";

const ROOT_SECTION_KEY = "__screen__";

export function normalizeSectionKey(sectionKey?: string): string {
  return sectionKey?.trim() || ROOT_SECTION_KEY;
}

export function buildTaskKey(input: LoadingTaskInput): string {
  return [
    input.screenKey,
    input.tier,
    normalizeSectionKey(input.sectionKey),
    input.taskId,
  ].join("::");
}

export function buildScreenKey(
  routeName: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return routeName;
  }

  const serializedParams = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");

  return serializedParams ? `${routeName}?${serializedParams}` : routeName;
}

function collectScreenTasks(
  state: LoadingState,
  screenKey: string,
  sectionKey?: string,
): LoadingTaskRecord[] {
  const normalizedSection = sectionKey ? normalizeSectionKey(sectionKey) : null;

  return Object.values(state.tasks).filter((task) => {
    if (task.screenKey !== screenKey) {
      return false;
    }
    if (!normalizedSection) {
      return true;
    }
    return normalizeSectionKey(task.sectionKey) === normalizedSection;
  });
}

function getTierCount(tasks: LoadingTaskRecord[], tier: LoadingTier): number {
  return tasks
    .filter((task) => task.tier === tier)
    .reduce((sum, task) => sum + task.count, 0);
}

export function getScreenLoadingSnapshot(
  state: LoadingState,
  screenKey: string,
): LoadingScreenSnapshot {
  const tasks = collectScreenTasks(state, screenKey);
  const criticalCount = getTierCount(tasks, "critical");
  const nonCriticalCount = getTierCount(tasks, "non_critical");

  return {
    screenKey,
    criticalCount,
    nonCriticalCount,
    hasCritical: criticalCount > 0,
    hasNonCritical: nonCriticalCount > 0,
    isLoading: criticalCount > 0 || nonCriticalCount > 0,
    activeTaskIds: tasks.map((task) => task.taskId),
  };
}

export function getSectionLoadingSnapshot(
  state: LoadingState,
  screenKey: string,
  sectionKey: string,
): LoadingSectionSnapshot {
  const tasks = collectScreenTasks(state, screenKey, sectionKey);
  const criticalCount = getTierCount(tasks, "critical");
  const nonCriticalCount = getTierCount(tasks, "non_critical");

  return {
    screenKey,
    sectionKey,
    criticalCount,
    nonCriticalCount,
    hasCritical: criticalCount > 0,
    hasNonCritical: nonCriticalCount > 0,
    isLoading: criticalCount > 0 || nonCriticalCount > 0,
    activeTaskIds: tasks.map((task) => task.taskId),
  };
}
