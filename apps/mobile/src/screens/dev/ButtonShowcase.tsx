import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { appTheme } from "@/apps/mobile/src/design/theme";
import GlassButton from "@/apps/mobile/src/ui/GlassButton";
import GlassIconButton from "@/apps/mobile/src/ui/GlassIconButton";
import SegmentedPill from "@/apps/mobile/src/ui/SegmentedPill";
import { colors } from "@/theme/colors";

export default function ButtonShowcase() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Glass Button Showcase</Text>

      <View style={styles.row}>
        <GlassButton label="Primary" variant="primary" />
        <GlassButton label="Secondary" variant="secondary" />
      </View>

      <View style={styles.row}>
        <GlassButton label="Ghost" variant="ghost" />
        <GlassButton label="Danger" variant="danger" />
      </View>

      <View style={styles.row}>
        <GlassButton label="Small" size="sm" />
        <GlassButton label="Medium" size="md" />
        <GlassButton label="Large" size="lg" />
      </View>

      <View style={styles.row}>
        <GlassButton label="Disabled" disabled />
      </View>

      <View style={styles.row}>
        <GlassIconButton
          accessibilityLabel="Back"
          icon={<FontAwesome name="chevron-left" size={14} color={appTheme.textPrimary} />}
        />
        <GlassIconButton
          accessibilityLabel="Menu"
          icon={<FontAwesome name="ellipsis-h" size={14} color={appTheme.textPrimary} />}
        />
        <GlassIconButton
          accessibilityLabel="Labeled"
          label="Share"
          icon={<FontAwesome name="share" size={14} color={appTheme.textPrimary} />}
        />
      </View>

      <SegmentedPill
        value="live"
        onChange={() => {}}
        options={[
          { value: "live", label: "Live" },
          { value: "stats", label: "Stats" },
          { value: "pbp", label: "Play-by-Play" },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
