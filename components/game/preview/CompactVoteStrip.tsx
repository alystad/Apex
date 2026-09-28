import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";

import { normalizeImageUri, previewSectionTitleStyle } from "./previewShared";

export type CompactVoteOption = {
  key: string;
  /** Team logo uri — rendered when provided. */
  logoUri?: string;
  label: string;
};

type CompactVoteStripProps = {
  title: string;
  /** Optional muted line under the title. */
  subtitle?: string;
  options: readonly [CompactVoteOption, CompactVoteOption];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};

/**
 * Compact two-option prediction strip (e.g. "Who Will Win" with team logos).
 */
export default function CompactVoteStrip({
  title,
  subtitle,
  options,
  selectedKey,
  onSelect,
}: CompactVoteStripProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Card elevated>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.optionsRow}>
        {options.map((option) => {
          const isSelected = selectedKey === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              style={[styles.option, isSelected ? styles.optionSelected : null]}
            >
              {option.logoUri ? (
                <Image
                  source={{ uri: normalizeImageUri(option.logoUri) }}
                  style={styles.optionLogo}
                />
              ) : null}
              <Text
                style={[
                  styles.optionLabel,
                  isSelected ? styles.optionLabelSelected : null,
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    headerRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: theme.spacing[8],
      marginBottom: theme.spacing[8],
    },
    title: previewSectionTitleStyle(theme),
    subtitle: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      flexShrink: 1,
      textAlign: "right",
    },
    optionsRow: {
      flexDirection: "row",
      gap: theme.spacing[12],
    },
    option: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[8],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[8],
      minHeight: 44,
    },
    optionSelected: {
      borderColor: theme.colors.accentStrong,
      backgroundColor: "rgba(255,255,255,0.08)",
      ...theme.shadows.glow,
    },
    optionLogo: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.pill,
    },
    optionLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    optionLabelSelected: {
      color: theme.colors.textPrimary,
    },
  });
}
