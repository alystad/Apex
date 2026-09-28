import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import type {
  LoadingAction,
  LoadingScreenSnapshot,
  LoadingSectionSnapshot,
  LoadingState,
  LoadingTaskInput,
} from "@/src/loading/loadingTypes";
import {
  buildTaskKey,
  getScreenLoadingSnapshot,
  getSectionLoadingSnapshot,
} from "@/src/loading/loadingUtils";

const LONG_RUNNING_TASK_WARNING_MS = 8000;

const initialState: LoadingState = {
  tasks: {},
};

type LoadingActions = {
  startTask: (input: LoadingTaskInput) => void;
  endTask: (input: LoadingTaskInput) => void;
  clearScreenTasks: (screenKey: string) => void;
};

const LoadingStateContext = createContext<LoadingState | null>(null);
const LoadingActionsContext = createContext<LoadingActions | null>(null);

function loadingReducer(state: LoadingState, action: LoadingAction): LoadingState {
  switch (action.type) {
    case "START_TASK": {
      const taskKey = buildTaskKey(action.payload);
      const existing = state.tasks[taskKey];
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [taskKey]: {
            ...action.payload,
            count: (existing?.count ?? 0) + 1,
            startedAt: existing?.startedAt ?? action.now,
          },
        },
      };
    }
    case "END_TASK": {
      const taskKey = buildTaskKey(action.payload);
      const existing = state.tasks[taskKey];
      if (!existing) {
        return state;
      }

      if (existing.count <= 1) {
        const nextTasks = { ...state.tasks };
        delete nextTasks[taskKey];
        return {
          ...state,
          tasks: nextTasks,
        };
      }

      return {
        ...state,
        tasks: {
          ...state.tasks,
          [taskKey]: {
            ...existing,
            count: existing.count - 1,
          },
        },
      };
    }
    case "CLEAR_SCREEN": {
      const nextTasks = Object.fromEntries(
        Object.entries(state.tasks).filter(
          ([, task]) => task.screenKey !== action.payload.screenKey,
        ),
      );
      return {
        ...state,
        tasks: nextTasks,
      };
    }
    default:
      return state;
  }
}

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(loadingReducer, initialState);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    const intervalId = setInterval(() => {
      const now = Date.now();
      const longRunningTasks = Object.values(state.tasks).filter(
        (task) => now - task.startedAt >= LONG_RUNNING_TASK_WARNING_MS,
      );

      if (longRunningTasks.length > 0) {
        console.warn(
          "[loading] long-running tasks",
          longRunningTasks.map((task) => ({
            screenKey: task.screenKey,
            tier: task.tier,
            sectionKey: task.sectionKey,
            taskId: task.taskId,
            ageMs: now - task.startedAt,
            count: task.count,
          })),
        );
      }
    }, LONG_RUNNING_TASK_WARNING_MS);

    return () => clearInterval(intervalId);
  }, [state.tasks]);

  const actions = useMemo<LoadingActions>(
    () => ({
      startTask: (input) =>
        dispatch({ type: "START_TASK", payload: input, now: Date.now() }),
      endTask: (input) => dispatch({ type: "END_TASK", payload: input }),
      clearScreenTasks: (screenKey) =>
        dispatch({ type: "CLEAR_SCREEN", payload: { screenKey } }),
    }),
    [],
  );

  return (
    <LoadingStateContext.Provider value={state}>
      <LoadingActionsContext.Provider value={actions}>
        {children}
      </LoadingActionsContext.Provider>
    </LoadingStateContext.Provider>
  );
}

function useLoadingState() {
  const context = useContext(LoadingStateContext);
  if (!context) {
    throw new Error("useLoadingState must be used within LoadingProvider");
  }
  return context;
}

function useLoadingActions() {
  const context = useContext(LoadingActionsContext);
  if (!context) {
    throw new Error("useLoadingActions must be used within LoadingProvider");
  }
  return context;
}

export function useLoading() {
  const state = useLoadingState();
  const actions = useLoadingActions();

  return useMemo(
    () => ({
      state,
      ...actions,
    }),
    [actions, state],
  );
}

export function useScreenLoading(screenKey: string): LoadingScreenSnapshot {
  const state = useLoadingState();
  return useMemo(
    () => getScreenLoadingSnapshot(state, screenKey),
    [screenKey, state],
  );
}

export function useSectionLoading(
  screenKey: string,
  sectionKey: string,
): LoadingSectionSnapshot {
  const state = useLoadingState();
  return useMemo(
    () => getSectionLoadingSnapshot(state, screenKey, sectionKey),
    [screenKey, sectionKey, state],
  );
}
