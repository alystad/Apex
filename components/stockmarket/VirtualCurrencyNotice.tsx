import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  marketColors,
  marketRadius,
  marketSpacing,
  marketType,
} from "@/src/features/stockmarket/marketTheme";
import { formatMoney, STARTING_CASH } from "@/src/features/stockmarket/pricing";

export const VIRTUAL_CURRENCY_LABEL =
  "Practice mode · Virtual currency · Not real money";

/**
 * The always-present disclosure. Styled as a bare grey caption rather than a
 * banner or badge — it stays visible on every screen in the section without
 * competing with the prices.
 */
export function VirtualCurrencyLabel({ align = "left" }: { align?: "left" | "center" }) {
  return (
    <Text
      accessibilityRole="text"
      style={[styles.label, align === "center" ? styles.labelCenter : null]}
    >
      {VIRTUAL_CURRENCY_LABEL}
    </Text>
  );
}

/** One-time explainer on first entry into the section. */
export function VirtualCurrencyIntroModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Practice trading</Text>
          <Text style={styles.copy}>
            Every balance, price, and gain in this section is virtual. There is no
            connection to real money — nothing to deposit, nothing to withdraw,
            nothing to cash out.
          </Text>
          <Text style={styles.copy}>
            Prices are WNBA players&apos; Impact Ratings rescaled: a 9.0 rating trades
            at $90. Live games move a price in real time; season holdings follow a
            player&apos;s rolling season average.
          </Text>
          <Text style={styles.copy}>
            You&apos;re starting with {formatMoney(STARTING_CASH)} in practice cash.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.buttonText}>Start trading</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: {
    ...marketType.micro,
    color: marketColors.textMuted,
    letterSpacing: 0.2,
  },
  labelCenter: {
    textAlign: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: marketSpacing[24],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: marketRadius.lg,
    backgroundColor: marketColors.sheet,
    padding: marketSpacing[24],
    gap: marketSpacing[12],
  },
  title: {
    ...marketType.sectionTitle,
    fontSize: 22,
    lineHeight: 28,
    color: marketColors.textPrimary,
  },
  copy: {
    ...marketType.rowSecondary,
    fontSize: 14,
    lineHeight: 20,
    color: marketColors.textSecondary,
  },
  button: {
    marginTop: marketSpacing[8],
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: marketRadius.pill,
    backgroundColor: marketColors.up,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    ...marketType.button,
    color: "#000000",
  },
});
