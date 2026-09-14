/** Types for the vendored cs0x7f/min2phase.js (MIT license option). Whole-file
 * import only — the implementation is never modified except the ESM export shim. */
export interface Min2PhaseApi {
  /** Solve a 54-char URFDLB facelet string; returns moves or "Error N". */
  solve(facelets: string): string;
  /** Random-state cube as a 54-char facelet string. */
  randomCube(): string;
  /** Facelet string of a solved cube after applying a Singmaster algorithm. */
  fromScramble(alg: string): string;
  /** Build full pruning tables (~350ms); later solves average ~5ms. */
  initFull(): void;
}

declare const api: Min2PhaseApi;
export default api;
