import type { Vec3 } from '../cube/types';

export type { Vec3 };

/** Everything the renderer needs to draw one cubelet, derived from CubeState. */
export interface CubeletVisual {
  readonly id: number;
  /** Integer home coordinates, -1|0|1 per axis. */
  readonly home: Vec3;
  /** Integer live coordinates, -1|0|1 per axis. */
  readonly position: Vec3;
  /** Live orientation as 9 ints, row-major 3x3. */
  readonly rotation: readonly number[];
  /**
   * Sticker normals in the cubelet's own frame. These never change for a given
   * cubelet — its rotation carries them — so the renderer can attach sticker
   * meshes once and let the group transform do the rest.
   */
  readonly stickers: readonly { readonly normal: Vec3; readonly color: string }[];
}
