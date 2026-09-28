import * as Clipboard from "expo-clipboard";
import { StyleSheet, Text, View } from "react-native";

import GlassButton from "@/apps/mobile/src/ui/GlassButton";

type Props = {
  message: string;
  commands: string;
  onRetry: () => void;
};

export default function ApiSetupScreen({ message, commands, onRetry }: Props) {
  const copyInstructions = async () => {
    await Clipboard.setStringAsync(`${message}\n\n${commands}`);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>API Setup Required</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.commandsCard}>
        <Text style={styles.commands}>{commands}</Text>
      </View>
      <View style={styles.actions}>
        <GlassButton label="Copy setup instructions" onPress={copyInstructions} variant="secondary" />
        <GlassButton label="Retry health check" onPress={onRetry} variant="primary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0f1624",
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 12,
  },
  title: {
    color: "#f1f7ff",
    fontSize: 20,
    fontWeight: "800",
  },
  message: {
    color: "#c8d9ef",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  commandsCard: {
    borderRadius: 12,
    backgroundColor: "#1b2639",
    padding: 12,
  },
  commands: {
    color: "#e8f1ff",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  actions: {
    gap: 10,
  },
});
