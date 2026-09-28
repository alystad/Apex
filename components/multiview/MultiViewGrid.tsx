import { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  StyleSheet,
  UIManager,
  View,
  type LayoutChangeEvent,
} from "react-native";

import MultiViewTile from "@/components/multiview/MultiViewTile";
import {
  computeMultiViewRects,
  resolveMultiViewDensity,
} from "@/src/multiview/layoutConstants";
import type { MultiViewLiveGameState } from "@/src/multiview/useMultiViewLiveGames";

type MultiViewGridProps = {
  games: MultiViewLiveGameState[];
  onOpenGame: (game: MultiViewLiveGameState) => void;
  onRemoveGame: (game: MultiViewLiveGameState) => void;
};

function makeStyles() {
  return StyleSheet.create({
    container: {
      flex: 1,
      minHeight: 0,
      position: "relative",
    },
    surface: {
      flex: 1,
      minHeight: 0,
      position: "relative",
    },
  });
}

function getLayoutAnimationConfig() {
  return {
    duration: 200,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  } as const;
}

export default function MultiViewGrid({
  games,
  onOpenGame,
  onRemoveGame,
}: MultiViewGridProps) {
  const styles = useMemo(() => makeStyles(), []);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  const count = Math.max(0, Math.min(4, games.length));
  const rects = useMemo(
    () =>
      computeMultiViewRects({
        count,
        availableWidth: availableSize.width,
        availableHeight: availableSize.height,
      }),
    [availableSize.height, availableSize.width, count],
  );

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    LayoutAnimation.configureNext(getLayoutAnimationConfig());
  }, [availableSize.height, availableSize.width, count]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, event.nativeEvent.layout.width);
    const nextHeight = Math.max(0, event.nativeEvent.layout.height);
    setAvailableSize((current) => {
      if (current.width === nextWidth && current.height === nextHeight) {
        return current;
      }
      return { width: nextWidth, height: nextHeight };
    });
  };

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <View style={styles.surface}>
        {games.slice(0, 4).map((game, index) => {
          const rect = rects[index];
          if (!rect) {
            return null;
          }
          const density = resolveMultiViewDensity(rect.height);
          return (
            <MultiViewTile
              key={game.data.key}
              gameId={game.data.gameId}
              game={game}
              rect={rect}
              density={density}
              onOpen={() => onOpenGame(game)}
              onRemove={() => onRemoveGame(game)}
            />
          );
        })}
      </View>
    </View>
  );
}
