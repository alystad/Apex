import type { ViewStyle } from "react-native";

export const CardContainer: ViewStyle = {
  backgroundColor: "#121212",
  borderRadius: 12,
  borderWidth: 0,
  borderColor: "transparent",
  padding: 14,
  shadowColor: "#000000",
  shadowOpacity: 0.35,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
};

export const CardContainerShell: ViewStyle = {
  ...CardContainer,
  padding: 0,
};
