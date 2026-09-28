import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  marketColors,
  marketRadius,
  marketSpacing,
  marketType,
  tabularNums,
} from "@/src/features/stockmarket/marketTheme";
import { maxAffordableShares } from "@/src/features/stockmarket/portfolioMath";
import {
  formatMoney,
  formatShares,
  MAX_SHARES_PER_ORDER,
  roundMoney,
  roundShares,
} from "@/src/features/stockmarket/pricing";
import type { StockHolding, StockHoldingKind } from "@/src/features/stockmarket/types";

export type TradeSide = "buy" | "sell";

type TradeSheetProps = {
  visible: boolean;
  side: TradeSide;
  playerName: string;
  kind: StockHoldingKind;
  price: number | null;
  cash: number;
  holding: StockHolding | null;
  onClose: () => void;
  onSubmit: (side: TradeSide, shares: number) => { ok: true } | { ok: false; reason: string };
};

const QUICK_SHARES = [1, 5, 10, 25];

/**
 * The order ticket, as a bottom sheet over a dimmed screen — the price stays
 * the largest thing on it, with the running order total directly beneath the
 * quantity, so the number that changes as you type is the one you're watching.
 */
export default function TradeSheet({
  visible,
  side,
  playerName,
  kind,
  price,
  cash,
  holding,
  onClose,
  onSubmit,
}: TradeSheetProps) {
  const [sharesText, setSharesText] = useState("1");
  const [error, setError] = useState<string | null>(null);

  // Reset the ticket every time it's reopened so a stale quantity from a
  // previous order never carries into a new one.
  useEffect(() => {
    if (visible) {
      setSharesText("1");
      setError(null);
    }
  }, [visible, side]);

  const sharesOwned = holding?.shares ?? 0;
  const parsed = Number.parseFloat(sharesText.replace(",", "."));
  const shares = Number.isFinite(parsed) && parsed > 0 ? roundShares(parsed) : 0;
  const total = price !== null ? roundMoney(shares * price) : null;
  const isBuy = side === "buy";
  const accent = isBuy ? marketColors.up : marketColors.textPrimary;

  const maxShares = useMemo(
    () => (isBuy ? (price !== null ? maxAffordableShares(cash, price) : 0) : sharesOwned),
    [cash, isBuy, price, sharesOwned],
  );

  const submit = () => {
    if (price === null) {
      setError("No price available yet.");
      return;
    }
    if (shares <= 0) {
      setError("Enter a quantity greater than 0.");
      return;
    }
    if (shares > MAX_SHARES_PER_ORDER) {
      setError(`Orders are capped at ${MAX_SHARES_PER_ORDER.toLocaleString("en-US")} shares.`);
      return;
    }
    const result = onSubmit(side, shares);
    if (result.ok) {
      onClose();
      return;
    }
    setError(result.reason);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss order ticket"
          style={styles.backdropFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.grabber} />

            <Text style={styles.eyebrow}>
              {isBuy ? "Buy" : "Sell"} · {kind === "game" ? "This game" : "Season"}
            </Text>
            <Text numberOfLines={1} style={styles.player}>
              {playerName}
            </Text>
            <Text style={styles.price}>
              {price === null ? "—" : `${formatMoney(price)} per share`}
            </Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Shares</Text>
              <TextInput
                value={sharesText}
                onChangeText={(value) => {
                  setError(null);
                  setSharesText(value.replace(/[^0-9.,]/g, ""));
                }}
                keyboardType="decimal-pad"
                selectTextOnFocus
                placeholder="0"
                placeholderTextColor={marketColors.textMuted}
                accessibilityLabel="Share quantity"
                style={styles.input}
              />
            </View>

            <View style={styles.quickRow}>
              {QUICK_SHARES.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  onPress={() => {
                    setError(null);
                    setSharesText(String(value));
                  }}
                  style={styles.quickChip}
                >
                  <Text style={styles.quickChipText}>{value}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setError(null);
                  setSharesText(formatShares(maxShares));
                }}
                style={styles.quickChip}
              >
                <Text style={styles.quickChipText}>Max</Text>
              </Pressable>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                {isBuy ? "Order total" : "Estimated proceeds"}
              </Text>
              <Text style={styles.totalValue}>
                {total === null ? "—" : formatMoney(total)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>
                {isBuy ? "Buying power" : "Shares held"}
              </Text>
              <Text style={styles.metaValue}>
                {isBuy ? formatMoney(cash) : formatShares(sharesOwned)}
              </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              onPress={submit}
              style={({ pressed }) => [
                styles.confirm,
                { backgroundColor: accent },
                pressed ? styles.confirmPressed : null,
              ]}
            >
              <Text style={styles.confirmText}>
                {isBuy ? "Confirm buy" : "Confirm sell"}
              </Text>
            </Pressable>

            <Text style={styles.disclaimer}>
              Practice order · Virtual currency · Not real money
            </Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    width: "100%",
  },
  sheet: {
    backgroundColor: marketColors.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: marketSpacing[20],
    paddingTop: marketSpacing[10],
    paddingBottom: marketSpacing[32],
    gap: marketSpacing[8],
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: marketColors.hairlineStrong,
    marginBottom: marketSpacing[12],
  },
  eyebrow: {
    ...marketType.micro,
    color: marketColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  player: {
    ...marketType.sectionTitle,
    fontSize: 20,
    lineHeight: 26,
    color: marketColors.textPrimary,
  },
  price: {
    ...marketType.rowSecondary,
    ...tabularNums,
    color: marketColors.textSecondary,
  },
  field: {
    marginTop: marketSpacing[12],
    gap: marketSpacing[6],
  },
  fieldLabel: {
    ...marketType.label,
    color: marketColors.textMuted,
  },
  input: {
    ...marketType.mediumValue,
    ...tabularNums,
    height: 60,
    borderRadius: marketRadius.md,
    backgroundColor: marketColors.sheetElevated,
    paddingHorizontal: marketSpacing[16],
    color: marketColors.textPrimary,
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: marketSpacing[6],
    marginTop: marketSpacing[4],
  },
  quickChip: {
    paddingHorizontal: marketSpacing[16],
    paddingVertical: marketSpacing[8],
    borderRadius: marketRadius.pill,
    backgroundColor: marketColors.sheetElevated,
  },
  quickChipText: {
    ...marketType.label,
    ...tabularNums,
    fontWeight: "700",
    color: marketColors.textSecondary,
  },
  totalRow: {
    marginTop: marketSpacing[16],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: marketSpacing[12],
  },
  totalLabel: {
    ...marketType.rowSecondary,
    color: marketColors.textSecondary,
  },
  totalValue: {
    ...marketType.sectionTitle,
    ...tabularNums,
    fontSize: 20,
    lineHeight: 26,
    color: marketColors.textPrimary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: marketSpacing[12],
  },
  metaLabel: {
    ...marketType.rowSecondary,
    color: marketColors.textMuted,
  },
  metaValue: {
    ...marketType.rowSecondary,
    ...tabularNums,
    color: marketColors.textSecondary,
  },
  error: {
    ...marketType.rowSecondary,
    color: marketColors.down,
  },
  confirm: {
    marginTop: marketSpacing[16],
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: marketRadius.pill,
  },
  confirmPressed: {
    opacity: 0.75,
  },
  confirmText: {
    ...marketType.button,
    color: "#000000",
  },
  disclaimer: {
    ...marketType.micro,
    marginTop: marketSpacing[10],
    textAlign: "center",
    color: marketColors.textMuted,
  },
});
