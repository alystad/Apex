import { memo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import TeamLogoLink from "@/components/TeamLogoLink";
import { colors } from "@/theme/colors";

type TeamPanelProps = {
  teamId?: string | null;
  uri: string;
  label: string;
  isHome?: boolean;
};

function TeamPanelComponent({ teamId, uri, label, isHome = false }: TeamPanelProps) {
  return (
    <View style={[styles.root, isHome ? styles.rootHome : styles.rootAway]}>
      <TeamLogoLink teamId={teamId} uri={uri} style={styles.logoWrap} />
      <Text style={[styles.label, isHome ? styles.labelHome : styles.labelAway]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 124,
    alignItems: "center",
    gap: 6,
  },
  rootHome: {
    alignSelf: "flex-end",
  },
  rootAway: {
    alignSelf: "flex-start",
  },
  logoWrap: {
    width: 36,
    height: 36,
  },
  label: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
  },
  labelHome: {
    textAlign: "center",
  },
  labelAway: {
    textAlign: "center",
  },
});

const TeamPanel = memo(TeamPanelComponent);

export default TeamPanel;
