import { Redirect } from "expo-router";

import CollapsingHeaderPreview from "@/apps/mobile/src/screens/dev/CollapsingHeaderPreview";

export default function CollapsingHeaderPreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <CollapsingHeaderPreview />;
}
