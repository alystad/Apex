import type {
  InGameSectionLayout,
  InGameSectionLayoutsByTab,
} from "@/src/ui/inGameSectionLayouts";
import type { InGameTabLayout } from "@/src/ui/inGameTabs";

export type ThemeMode = "system" | "light" | "dark" | "team";
export type CourtStyle = "minimal" | "detailed";
export type InGameTab = "court" | "stats" | "commentary";

export type SettingsState = {
  themeMode: ThemeMode;
  courtStyle: CourtStyle;
  useTeamColorsOnCourt: boolean;
  inGame: {
    sections: {
      momentum: boolean;
      liveImpact: boolean;
      betting: boolean;
      commentary: boolean;
    };
    defaultTab: InGameTab;
    liveDataDelaySeconds: number;
    tabLayout: InGameTabLayout;
    sectionLayoutsByTab: InGameSectionLayoutsByTab;
  };
};

export type InGameSectionKey = keyof SettingsState["inGame"]["sections"];

export type SettingsAction =
  | { type: "HYDRATE"; payload: SettingsState }
  | { type: "SET_THEME_MODE"; payload: ThemeMode }
  | { type: "SET_COURT_STYLE"; payload: CourtStyle }
  | { type: "TOGGLE_TEAM_COLORS" }
  | { type: "TOGGLE_SECTION"; payload: InGameSectionKey }
  | { type: "SET_DEFAULT_TAB"; payload: InGameTab }
  | { type: "SET_LIVE_DATA_DELAY"; payload: number }
  | { type: "SET_TAB_LAYOUT"; payload: InGameTabLayout }
  | { type: "RESET_TAB_LAYOUT" }
  | {
      type: "SET_SECTION_LAYOUT";
      payload: { tabKey: keyof SettingsState["inGame"]["sectionLayoutsByTab"]; layout: InGameSectionLayout };
    }
  | {
      type: "RESET_SECTION_LAYOUT";
      payload: keyof SettingsState["inGame"]["sectionLayoutsByTab"];
    }
  | { type: "RESET_DEFAULTS" };
