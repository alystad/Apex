import { memo, useMemo } from "react";
import { Image, StyleSheet, View } from "react-native";

const crownImage = require("@/assets/images/top-performer-crown.png");

type TopPerformerCrownProps = {
  size?: number;
};

function TopPerformerCrown({ size = 32 }: TopPerformerCrownProps) {
  const scaledSize = size * 1.5;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          width: scaledSize,
          height: scaledSize,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
          transform: [{ translateX: -4 }, { translateY: -6 }, { rotate: "-25deg" }],
        },
        image: {
          width: scaledSize,
          height: scaledSize,
          resizeMode: "contain",
          backgroundColor: "transparent",
        },
      }),
    [scaledSize],
  );

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Image source={crownImage} style={styles.image} />
    </View>
  );
}

export default memo(TopPerformerCrown);
