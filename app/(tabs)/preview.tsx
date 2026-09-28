import { useCallback } from "react";
import { router } from "expo-router";

import GameLiveScreen from "@/components/game/GameLiveScreen";
import GameRecapScreen from "@/components/game/GameRecapScreen";
import PreGamePreviewScreen from "@/components/game/PreGamePreviewScreen";
import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import TabContentSkeleton from "@/components/loading/TabContentSkeleton";
import { useLiveGame } from "@/hooks/useLiveGame";
import { useProfile } from "@/src/profile/ProfileContext";
import { buildPredictionSnapshotFromLiveGame } from "@/src/profile/predictionResolution";
import { getGameStoryPhase } from "@/src/ui/gameStoryTab";

/**
 * The game's "story" tab — always the first tab position, and the tab every
 * game screen opens on. It's a single persistent tab whose content and label
 * both follow the game's status: Preview before tip-off, Live in progress,
 * Recap once final. The label side lives in app/(tabs)/_layout.tsx; both read
 * the same `getGameStoryPhase` so they can never disagree.
 *
 * Transitions are automatic: `data.status.state` comes from the same polled
 * live-game feed that drives the rest of the screen, so tip-off and the final
 * buzzer swap this tab over on the next poll with no manual refresh.
 */
export default function GameStoryTab() {
  const { data, setGameId } = useLiveGame();
  const { state: profileState, savePrediction } = useProfile();

  const handleMeetingPress = useCallback(
    (gameId: string) => {
      if (!data) return;
      setGameId(gameId, data.mode);
      // The dedicated Summary tab was removed — this story tab already
      // shows a finished meeting's recap on its own (phase resolves to
      // "recap" once setGameId switches to a past game), so re-navigating
      // to this same route is enough to land there.
      router.replace("/(tabs)/preview" as never);
    },
    [data, setGameId],
  );

  const phase = getGameStoryPhase(data?.status?.state);

  if (data && phase === "recap") {
    return <GameRecapScreen data={data} />;
  }
  if (data && phase === "live") {
    return <GameLiveScreen data={data} />;
  }

  const predictionSnapshot = buildPredictionSnapshotFromLiveGame(data);
  if (!data || !predictionSnapshot) {
    // No blocking loading screen anymore — this is the brief window before
    // even the instant-shell seed/first network response lands (e.g. a cold
    // deep link with nothing stashed for it). Shows a skeleton shaped like
    // this tab's real card stack instead of a blank screen.
    return (
      <GameTabScreenScaffold>
        <TabContentSkeleton cards={4} />
      </GameTabScreenScaffold>
    );
  }

  const existingPrediction =
    profileState.predictions.find(
      (prediction) =>
        prediction.gameId === predictionSnapshot.gameId &&
        prediction.mode === predictionSnapshot.mode,
    ) ?? null;

  return (
    <PreGamePreviewScreen
      data={data}
      predictionSnapshot={predictionSnapshot}
      prediction={existingPrediction}
      onSavePrediction={(pickedTeamId) => {
        savePrediction(predictionSnapshot, pickedTeamId);
      }}
      onMeetingPress={handleMeetingPress}
    />
  );
}
