import FontAwesome from "@expo/vector-icons/FontAwesome";
import Feather from "@expo/vector-icons/Feather";
import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const SIZE = 48;
// More pronounced press: ~12% shrink so you visibly feel the button compress.
const PRESSED_SCALE = 0.88;
// How much the glass + icon dim while pressed.
const PRESS_DIM = 0.3;
// Press-down: fast compress that decelerates hard (ease-out), ~80ms.
const PRESS_IN_TIMING = {
  duration: 80,
  easing: Easing.out(Easing.cubic),
} as const;
// Release: underdamped spring — settles with a small, satisfying overshoot
// before landing at rest. Feels alive without being toy-like.
const RELEASE_SPRING = {
  damping: 10,
  stiffness: 400,
  mass: 1,
} as const;

type HeaderMenuButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  icon?:
    | React.ComponentProps<typeof FontAwesome>["name"]
    | React.ComponentProps<typeof Feather>["name"];
  /**
   * FontAwesome's glyphs at this size render as noticeably heavy/bold
   * strokes. Feather's glyphs are stroke-based and much lighter at the same
   * point size — pass "Feather" (with a Feather-valid `icon` name, e.g.
   * "chevron-left" / "more-horizontal") for a sleeker look without shrinking
   * the icon itself. Defaults to "FontAwesome" so every existing call site
   * (which passes FontAwesome names) renders unchanged.
   */
  iconFamily?: "FontAwesome" | "Feather";
  iconSize?: number;
  iconColor?: string;
  /**
   * "circle" (default) is the tight square glass button used for back/more-
   * actions icons. "pill" widens it into a capsule with generous horizontal
   * padding — same glass background and the same press animation below,
   * just a different silhouette — for standalone icon buttons that read
   * better as a pill (e.g. the hamburger menu button).
   */
  shape?: "circle" | "pill";
  /**
   * Visual-only escape hatch: renders no glass/border/fill behind the icon
   * at all — just the icon floating on whatever sits behind it — while
   * keeping the exact same hit-target size and press animation. Defaults to
   * true (background shown) so every existing call site is unaffected;
   * opt out per-usage rather than changing the shared default.
   */
  showBackground?: boolean;
};

function triggerPressHaptic() {
  if (Platform.OS !== "ios") {
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Circular glass icon button used for the hamburger menu and any other
// header actions that need the same frosted-glass look + spring animation.
// Pass `icon` to change the FontAwesome glyph (defaults to "bars").
export default function HeaderMenuButton({
  onPress,
  accessibilityLabel = "Open menu",
  icon = "bars",
  iconFamily = "FontAwesome",
  iconSize = 20,
  iconColor = "#FFFFFF",
  shape = "circle",
  showBackground = true,
}: HeaderMenuButtonProps) {
  const scale = useSharedValue(1);
  const press = useSharedValue(0);
  const isPill = shape === "pill";

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 1 - press.value * PRESS_DIM,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => {
        triggerPressHaptic();
        scale.value = withTiming(PRESSED_SCALE, PRESS_IN_TIMING);
        press.value = withTiming(1, PRESS_IN_TIMING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, RELEASE_SPRING);
        press.value = withSpring(0, RELEASE_SPRING);
      }}
    >
      <Animated.View
        style={[
          styles.button,
          isPill ? styles.buttonPill : styles.buttonCircle,
          showBackground ? null : styles.buttonNoBackground,
          animatedStyle,
        ]}
      >
        {showBackground ? (
          Platform.OS === "ios" ? (
            <View pointerEvents="none" style={styles.glassMask}>
              <GlassView
                glassEffectStyle="regular"
                colorScheme="dark"
                isInteractive={false}
                style={styles.glass}
              />
            </View>
          ) : (
            <View pointerEvents="none" style={styles.fallbackGlass} />
          )
        ) : null}
        {iconFamily === "Feather" ? (
          <Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={iconSize} color={iconColor} />
        ) : (
          <FontAwesome name={icon as React.ComponentProps<typeof FontAwesome>["name"]} size={iconSize} color={iconColor} />
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  // showBackground=false: no visible circle/pill shape at all — the icon
  // floats directly on whatever's behind it. Hit-target size/shape (from
  // buttonCircle/buttonPill) and the press animation are untouched.
  buttonNoBackground: {
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  buttonCircle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  // Wider capsule silhouette for standalone icon buttons — same height as
  // the circular variant, generous horizontal padding instead of a fixed
  // square, fully pill-rounded corners.
  buttonPill: {
    height: SIZE,
    paddingHorizontal: 18,
    borderRadius: 999,
  },
  glassMask: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: "hidden",
  },
  glass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: "hidden",
  },
  fallbackGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
});
