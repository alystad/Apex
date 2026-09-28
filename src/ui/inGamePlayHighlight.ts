// Hands off "scroll to and flash this play" requests from the Court tab's
// Last Play card to the Plays tab. A plain event wouldn't survive the target
// tab being lazy-mounted (it isn't listening yet when the event fires), so
// this stores the request instead and the Plays tab consumes it once it's
// ready — on focus, and again whenever its play list updates in case the
// target play hadn't loaded yet.
let pendingPlayId: string | null = null;

export function requestPlayHighlight(playId: string): void {
  pendingPlayId = playId;
}

export function consumePendingPlayHighlight(): string | null {
  const id = pendingPlayId;
  pendingPlayId = null;
  return id;
}
