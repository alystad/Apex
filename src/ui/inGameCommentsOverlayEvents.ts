type InGameCommentsOverlayListener = () => void;

const listeners = new Set<InGameCommentsOverlayListener>();

export function openInGameCommentsOverlay(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeToInGameCommentsOverlay(
  listener: InGameCommentsOverlayListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
