import { Redirect } from "expo-router";

import ButtonShowcase from "@/apps/mobile/src/screens/dev/ButtonShowcase";

export default function ButtonShowcaseRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <ButtonShowcase />;
}
