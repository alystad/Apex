import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_SETTINGS_STATE } from "@/src/settings/settingsDefaults";
import {
  loadSettingsState,
  saveSettingsState,
} from "@/src/settings/settingsStorage";
import type {
  CourtStyle,
  InGameSectionKey,
  InGameTab,
  SettingsAction,
  SettingsState,
  ThemeMode,
} from "@/src/settings/settingsTypes";
import type { InGameRouteKey } from "@/src/ui/inGameRoutes";
import type { InGameTabLayout } from "@/src/ui/inGameTabs";

type SettingsStateContextValue = {
  state: SettingsState;
  isHydrated: boolean;
};

type SettingsActionsContextValue = {
  setThemeMode: (value: ThemeMode) => void;
  setCourtStyle: (value: CourtStyle) => void;
  toggleTeamColorsOnCourt: () => void;
  toggleInGameSection: (key: InGameSectionKey) => void;
  setDefaultInGameTab: (tab: InGameTab) => void;
  setLiveDataDelaySeconds: (seconds: number) => void;
  setInGameTabLayout: (layout: InGameTabLayout) => void;
  resetInGameTabLayout: () => void;
  setInGameSectionLayout: (
    tabKey: InGameRouteKey,
    layout: { order: string[]; hidden: string[] },
  ) => void;
  resetInGameSectionLayout: (tabKey: InGameRouteKey) => void;
  resetToDefaults: () => void;
};

const SettingsStateContext = createContext<SettingsStateContextValue | null>(
  null,
);
const SettingsActionsContext = createContext<SettingsActionsContextValue | null>(
  null,
);

function settingsReducer(
  state: SettingsState,
  action: SettingsAction,
): SettingsState {
  switch (action.type) {
    case "HYDRATE":
      return action.payload;
    case "SET_THEME_MODE":
      return {
        ...state,
        themeMode: action.payload,
      };
    case "SET_COURT_STYLE":
      return {
        ...state,
        courtStyle: action.payload,
      };
    case "TOGGLE_TEAM_COLORS":
      return {
        ...state,
        useTeamColorsOnCourt: !state.useTeamColorsOnCourt,
      };
    case "TOGGLE_SECTION":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          sections: {
            ...state.inGame.sections,
            [action.payload]: !state.inGame.sections[action.payload],
          },
        },
      };
    case "SET_DEFAULT_TAB":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          defaultTab: action.payload,
        },
      };
    case "SET_LIVE_DATA_DELAY":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          liveDataDelaySeconds: Math.max(0, Math.min(120, Math.round(action.payload))),
        },
      };
    case "SET_TAB_LAYOUT":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          tabLayout: {
            order: [...action.payload.order],
            hidden: [...action.payload.hidden],
          },
        },
      };
    case "RESET_TAB_LAYOUT":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          tabLayout: {
            order: [...DEFAULT_SETTINGS_STATE.inGame.tabLayout.order],
            hidden: [...DEFAULT_SETTINGS_STATE.inGame.tabLayout.hidden],
          },
        },
      };
    case "SET_SECTION_LAYOUT":
      return {
        ...state,
        inGame: {
          ...state.inGame,
          sectionLayoutsByTab: {
            ...state.inGame.sectionLayoutsByTab,
            [action.payload.tabKey]: action.payload.layout,
          },
        },
      };
    case "RESET_SECTION_LAYOUT": {
      const nextLayouts = { ...state.inGame.sectionLayoutsByTab };
      delete nextLayouts[action.payload];
      return {
        ...state,
        inGame: {
          ...state.inGame,
          sectionLayoutsByTab: nextLayouts,
        },
      };
    }
    case "RESET_DEFAULTS":
      return DEFAULT_SETTINGS_STATE;
    default:
      return state;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(settingsReducer, DEFAULT_SETTINGS_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    let active = true;

    void loadSettingsState().then((loadedState) => {
      if (!active) {
        return;
      }
      dispatch({ type: "HYDRATE", payload: loadedState });
      lastSavedRef.current = JSON.stringify(loadedState);
      setIsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) {
      return;
    }

    lastSavedRef.current = serialized;
    void saveSettingsState(state);
  }, [isHydrated, state]);

  const actions = useMemo<SettingsActionsContextValue>(
    () => ({
      setThemeMode: (value) =>
        dispatch({ type: "SET_THEME_MODE", payload: value }),
      setCourtStyle: (value) =>
        dispatch({ type: "SET_COURT_STYLE", payload: value }),
      toggleTeamColorsOnCourt: () => dispatch({ type: "TOGGLE_TEAM_COLORS" }),
      toggleInGameSection: (key) =>
        dispatch({ type: "TOGGLE_SECTION", payload: key }),
      setDefaultInGameTab: (tab) =>
        dispatch({ type: "SET_DEFAULT_TAB", payload: tab }),
      setLiveDataDelaySeconds: (seconds) =>
        dispatch({ type: "SET_LIVE_DATA_DELAY", payload: seconds }),
      setInGameTabLayout: (layout) =>
        dispatch({
          type: "SET_TAB_LAYOUT",
          payload: {
            order: [...layout.order],
            hidden: [...layout.hidden],
          },
        }),
      resetInGameTabLayout: () => dispatch({ type: "RESET_TAB_LAYOUT" }),
      setInGameSectionLayout: (tabKey, layout) =>
        dispatch({
          type: "SET_SECTION_LAYOUT",
          payload: {
            tabKey,
            layout: {
              order: [...layout.order],
              hidden: [...layout.hidden],
            },
          },
        }),
      resetInGameSectionLayout: (tabKey) =>
        dispatch({ type: "RESET_SECTION_LAYOUT", payload: tabKey }),
      resetToDefaults: () => dispatch({ type: "RESET_DEFAULTS" }),
    }),
    [],
  );

  const stateValue = useMemo(
    () => ({
      state,
      isHydrated,
    }),
    [isHydrated, state],
  );

  return (
    <SettingsStateContext.Provider value={stateValue}>
      <SettingsActionsContext.Provider value={actions}>
        {children}
      </SettingsActionsContext.Provider>
    </SettingsStateContext.Provider>
  );
}

export function useSettingsState() {
  const context = useContext(SettingsStateContext);
  if (!context) {
    throw new Error("useSettingsState must be used within SettingsProvider");
  }
  return context;
}

export function useSettingsActions() {
  const context = useContext(SettingsActionsContext);
  if (!context) {
    throw new Error("useSettingsActions must be used within SettingsProvider");
  }
  return context;
}

export function useSettings() {
  const stateContext = useSettingsState();
  const actions = useSettingsActions();

  return useMemo(
    () => ({
      ...stateContext,
      ...actions,
    }),
    [actions, stateContext],
  );
}
