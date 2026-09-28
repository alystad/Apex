import { useMemo } from "react";
import {
  Text as RNText,
  StyleSheet,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";
import { tokens } from "@/src/ui/tokens";

export type AppTextVariant = "title" | "subtitle" | "body" | "caption";
export type AppTextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "accent"
  | "success"
  | "warning"
  | "danger";

export type AppTextProps = RNTextProps & {
  variant?: AppTextVariant;
  tone?: AppTextTone;
  style?: StyleProp<TextStyle>;
};

export default function Text({
  variant = "body",
  tone = "primary",
  style,
  ...rest
}: AppTextProps) {
  const { tokens: theme } = useAppTheme();
  const toneColor = useMemo<Record<AppTextTone, string>>(
    () => ({
      primary: theme.colors.textPrimary,
      secondary: theme.colors.textSecondary,
      tertiary: theme.colors.textMuted,
      accent: theme.colors.accentStrong,
      success: theme.colors.success,
      warning: theme.colors.warning,
      danger: theme.colors.danger,
    }),
    [theme.colors],
  );

  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        styles[variant],
        { color: toneColor[tone] },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  title: {
    fontSize: tokens.type.title.fontSize,
    lineHeight: tokens.type.title.lineHeight,
    fontWeight: tokens.type.title.fontWeight,
  },
  subtitle: {
    fontSize: tokens.type.subtitle.fontSize,
    lineHeight: tokens.type.subtitle.lineHeight,
    fontWeight: tokens.type.subtitle.fontWeight,
  },
  body: {
    fontSize: tokens.type.body.fontSize,
    lineHeight: tokens.type.body.lineHeight,
    fontWeight: tokens.type.body.fontWeight,
  },
  caption: {
    fontSize: tokens.type.caption.fontSize,
    lineHeight: tokens.type.caption.lineHeight,
    fontWeight: tokens.type.caption.fontWeight,
  },
});
