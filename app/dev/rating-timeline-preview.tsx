import { Redirect } from "expo-router";

import RatingTimelinePreviewScreen from "@/apps/mobile/src/screens/dev/RatingTimelinePreviewScreen";

export default function RatingTimelinePreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <RatingTimelinePreviewScreen />;
}
