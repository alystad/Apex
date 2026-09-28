export type LoadingTier = "critical" | "non_critical";

export type LoadingTaskInput = {
  screenKey: string;
  tier: LoadingTier;
  sectionKey?: string;
  taskId: string;
};

export type LoadingTaskRecord = LoadingTaskInput & {
  count: number;
  startedAt: number;
};

export type LoadingState = {
  tasks: Record<string, LoadingTaskRecord>;
};

export type LoadingScreenSnapshot = {
  screenKey: string;
  criticalCount: number;
  nonCriticalCount: number;
  hasCritical: boolean;
  hasNonCritical: boolean;
  isLoading: boolean;
  activeTaskIds: string[];
};

export type LoadingSectionSnapshot = {
  screenKey: string;
  sectionKey: string;
  criticalCount: number;
  nonCriticalCount: number;
  hasCritical: boolean;
  hasNonCritical: boolean;
  isLoading: boolean;
  activeTaskIds: string[];
};

export type LoadingAction =
  | { type: "START_TASK"; payload: LoadingTaskInput; now: number }
  | { type: "END_TASK"; payload: LoadingTaskInput }
  | { type: "CLEAR_SCREEN"; payload: { screenKey: string } };
