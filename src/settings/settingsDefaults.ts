import type { SettingsState } from "@/src/settings/settingsTypes";
import { getDefaultInGameTabLayout } from "@/src/ui/inGameTabs";

export const DEFAULT_SETTINGS_STATE: SettingsState = {
  themeMode: "system",
  courtStyle: "detailed",
  useTeamColorsOnCourt: true,
  inGame: {
    sections: {
      momentum: true,
      liveImpact: true,
      betting: true,
      commentary: true,
    },
    defaultTab: "court",
    liveDataDelaySeconds: 0,
    tabLayout: getDefaultInGameTabLayout(),
    sectionLayoutsByTab: {},
  },
};
