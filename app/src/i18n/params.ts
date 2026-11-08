// Constants used in copy (ux-spec section 0). The API does not expose them: keep in sync with the Worker vars
// POINTS_WIN / POINTS_LOSS.
export const WIN_POINTS = 20;
export const LOSS_POINTS = 10;

/** Map names stay English in both languages (ux-spec section 0). */
export const MAP_NAMES = { 1: "Basic", 2: "Ice Age", 3: "Mysterious Forest", 4: "Lava Lake" } as const;
