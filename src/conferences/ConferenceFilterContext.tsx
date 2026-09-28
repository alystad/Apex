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

import {
  DEFAULT_CONFERENCE_FILTER_STATE,
  loadConferenceFilterState,
  saveConferenceFilterState,
} from "@/src/conferences/conferenceFilterStorage";
import type {
  ConferenceFilterAction,
  ConferenceFilterState,
  ConferenceOption,
} from "@/src/conferences/conferenceFilterTypes";

type ConferenceFilterStateContextValue = {
  state: ConferenceFilterState;
  isHydrated: boolean;
};

type ConferenceFilterActionsContextValue = {
  setSelectedConference: (option: ConferenceOption) => void;
  resetConferenceFilter: () => void;
};

const ConferenceFilterStateContext =
  createContext<ConferenceFilterStateContextValue | null>(null);
const ConferenceFilterActionsContext =
  createContext<ConferenceFilterActionsContextValue | null>(null);

function conferenceFilterReducer(
  state: ConferenceFilterState,
  action: ConferenceFilterAction,
): ConferenceFilterState {
  switch (action.type) {
    case "HYDRATE":
      return action.payload;
    case "SET_SELECTED_CONFERENCE":
      return {
        selectedConferenceKey: action.payload.key,
        selectedConferenceLabel: action.payload.label,
      };
    case "RESET":
      return DEFAULT_CONFERENCE_FILTER_STATE;
    default:
      return state;
  }
}

export function ConferenceFilterProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    conferenceFilterReducer,
    DEFAULT_CONFERENCE_FILTER_STATE,
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSavedRef = useRef("");

  useEffect(() => {
    let active = true;

    void loadConferenceFilterState().then((loadedState) => {
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
    void saveConferenceFilterState(state);
  }, [isHydrated, state]);

  const actions = useMemo<ConferenceFilterActionsContextValue>(
    () => ({
      setSelectedConference: (option) =>
        dispatch({ type: "SET_SELECTED_CONFERENCE", payload: option }),
      resetConferenceFilter: () => dispatch({ type: "RESET" }),
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
    <ConferenceFilterStateContext.Provider value={stateValue}>
      <ConferenceFilterActionsContext.Provider value={actions}>
        {children}
      </ConferenceFilterActionsContext.Provider>
    </ConferenceFilterStateContext.Provider>
  );
}

export function useConferenceFilterState() {
  const context = useContext(ConferenceFilterStateContext);
  if (!context) {
    throw new Error(
      "useConferenceFilterState must be used within ConferenceFilterProvider",
    );
  }
  return context;
}

export function useConferenceFilterActions() {
  const context = useContext(ConferenceFilterActionsContext);
  if (!context) {
    throw new Error(
      "useConferenceFilterActions must be used within ConferenceFilterProvider",
    );
  }
  return context;
}

export function useConferenceFilter() {
  const stateContext = useConferenceFilterState();
  const actions = useConferenceFilterActions();

  return useMemo(
    () => ({
      ...stateContext,
      ...actions,
    }),
    [actions, stateContext],
  );
}
