import { memo } from "react";
import { Image, Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { useGameModeState } from "@/src/mode/GameModeContext";

type TeamLogoLinkProps = {
  teamId?: string | null;
  uri: string;
  style?: StyleProp<ViewStyle>;
};

function TeamLogoLinkComponent({ teamId, uri, style }: TeamLogoLinkProps) {
  const router = useRouter();
  const { mode } = useGameModeState();
  return (
    <Pressable
      onPress={() => {
        if (!teamId) {
          return;
        }
        router.push({ pathname: "/team/[teamId]", params: { teamId, mode } } as never);
      }}
      disabled={!teamId}
      style={style}
    >
      <Image source={{ uri }} style={styles.logo} resizeMode="contain" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: "100%",
    height: "100%",
  },
});

const TeamLogoLink = memo(TeamLogoLinkComponent);

export default TeamLogoLink;
