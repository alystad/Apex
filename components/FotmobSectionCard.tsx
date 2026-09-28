import { useMemo, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import { useAppTheme } from "@/src/theme/useAppTheme";

type FotmobSectionCardProps = {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  hideHeader?: boolean;
  bodyStyle?: StyleProp<ViewStyle>;
};

export default function FotmobSectionCard({
  title,
  subtitle,
  right,
  children,
  hideHeader = false,
  bodyStyle,
}: FotmobSectionCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          paddingHorizontal: theme.cardPadding.md,
          paddingTop: theme.cardPadding.md,
          paddingBottom: theme.spacing[12],
          borderBottomWidth: theme.borderWidth.hairline,
          borderBottomColor: theme.colors.borderSoft,
        },
        body: {
          paddingHorizontal: theme.cardPadding.md,
          paddingVertical: theme.cardPadding.md,
          gap: theme.spacing[10],
        },
      }),
    [theme],
  );

  return (
    <Card padded={false}>
      {!hideHeader && title ? (
        <View style={styles.header}>
          <SectionHeader title={title} subtitle={subtitle} right={right} />
        </View>
      ) : null}
      <View style={[styles.body, bodyStyle]}>{children}</View>
    </Card>
  );
}
