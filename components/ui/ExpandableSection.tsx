import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";

type ExpandableSectionProps = {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  rightLabel?: string;
  right?: ReactNode;
  collapsible?: boolean;
  centerTitle?: boolean;
  showHeaderDivider?: boolean;
};

export default function ExpandableSection({
  title,
  children,
  defaultExpanded = true,
  rightLabel,
  right,
  collapsible = true,
  centerTitle = false,
  showHeaderDivider = true,
}: ExpandableSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          overflow: "hidden",
        },
        header: {
          minHeight: theme.controlHeights.lg,
          paddingHorizontal: theme.cardPadding.md,
          paddingVertical: theme.spacing[14],
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottomWidth: theme.borderWidth.hairline,
          borderBottomColor: theme.colors.borderSoft,
        },
        headerCentered: {
          justifyContent: "center",
        },
        headerNoDivider: {
          borderBottomWidth: 0,
        },
        title: {
          fontSize: 13,
          lineHeight: 15,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        titleCentered: {
          textAlign: "center",
        },
        right: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[8],
        },
        rightFloating: {
          position: "absolute",
          right: theme.cardPadding.md,
        },
        rightLabel: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textMuted,
        },
        chevronWrap: {
          width: 28,
          height: 28,
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.glass,
          alignItems: "center",
          justifyContent: "center",
        },
        chevron: {
          fontSize: 16,
          lineHeight: 20,
          fontWeight: "800",
          color: theme.colors.textSecondary,
        },
        body: {
          paddingHorizontal: theme.cardPadding.md,
          paddingVertical: theme.spacing[14],
          gap: theme.spacing[10],
        },
      }),
    [theme],
  );

  const isExpanded = collapsible ? expanded : true;
  const headerStyles = [
    styles.header,
    centerTitle ? styles.headerCentered : null,
    showHeaderDivider ? null : styles.headerNoDivider,
  ];
  const rightStyles = [styles.right, centerTitle ? styles.rightFloating : null];

  return (
    <Card padded={false}>
      {collapsible ? (
        <Pressable onPress={() => setExpanded((prev) => !prev)} style={headerStyles}>
          <Text style={[styles.title, centerTitle ? styles.titleCentered : null]}>{title}</Text>
          <View style={rightStyles}>
            {right}
            {rightLabel ? <Text style={styles.rightLabel}>{rightLabel}</Text> : null}
            <View style={styles.chevronWrap}>
              <Text style={styles.chevron}>{expanded ? "-" : "+"}</Text>
            </View>
          </View>
        </Pressable>
      ) : (
        <View style={headerStyles}>
          <Text style={[styles.title, centerTitle ? styles.titleCentered : null]}>{title}</Text>
          <View style={rightStyles}>
            {right}
            {rightLabel ? <Text style={styles.rightLabel}>{rightLabel}</Text> : null}
          </View>
        </View>
      )}
      {isExpanded ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}
