import { tokens } from "@/src/theme/tokens";

export const effects = {
  card: tokens.shadows.card,
  elevated: tokens.shadows.floating,
  pressed: {
    opacity: tokens.opacity.pressed,
  },
  disabled: {
    opacity: tokens.opacity.disabled,
  },
  divider: {
    borderBottomWidth: tokens.borderWidth.hairline,
    borderBottomColor: tokens.colors.borderSoft,
  },
} as const;
