import { useMemo, type ReactElement, type ReactNode } from "react";
import {
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useAppTheme } from "@/src/theme/useAppTheme";

export type AppScreenProps = {
  children: ReactNode;
  edges?: Edge[];
  padded?: boolean;
  scroll?: boolean;
  showAmbient?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
};

export default function AppScreen({
  children,
  edges = ["top", "left", "right"],
  padded = true,
  scroll = false,
  showAmbient = true,
  style,
  contentContainerStyle,
  refreshControl,
}: AppScreenProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: theme.colors.bg,
        },
        body: {
          flex: 1,
          backgroundColor: "transparent",
        },
        content: {
          flex: 1,
        },
        padded: {
          paddingHorizontal: theme.spacing[8],
          paddingTop: theme.spacing[10],
          paddingBottom: theme.spacing[28],
          gap: theme.spacing[12],
        },
        ambientWrap: {
          ...StyleSheet.absoluteFillObject,
          overflow: "hidden",
        },
        ambientTop: {
          position: "absolute",
          top: -190,
          left: -72,
          right: -72,
          height: 380,
          borderRadius: 280,
          backgroundColor: theme.colors.ambientTop,
        },
        ambientBottom: {
          position: "absolute",
          bottom: -220,
          left: -92,
          right: -92,
          height: 390,
          borderRadius: 300,
          backgroundColor: theme.colors.ambientBottom,
        },
      }),
    [theme],
  );
  const contentStyles = [styles.content, padded ? styles.padded : null, contentContainerStyle];

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.screen, style]}
    >
      {showAmbient ? (
        <View pointerEvents="none" style={styles.ambientWrap}>
          <View style={styles.ambientTop} />
          <View style={styles.ambientBottom} />
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={contentStyles}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={contentStyles}>{children}</View>
      )}
    </SafeAreaView>
  );
}
