import { describe, expect, it } from 'vitest';

import { CubeState } from './CubeState';
import { isDraggableSticker, resolveDragTurn, stickerWorldNormal } from './dragTurn';
import { FACE_AXES } from './palette';
import type { AxisName, FaceLetter, Vec3 } from './types';
import { FACE_LETTERS } from './types';

/** description, sticker world normal, drag direction, cubelet position, expected move */
const DOCUMENTED: [string, Vec3, Vec3, Vec3, FaceLetter, 1 | 3][] = [
  ['U-face front edge dragged right turns F', [0, 1, 0], [1, 0, 0], [0, 1, 1], 'F', 1],
  ['U-face right edge dragged forward turns R prime', [0, 1, 0], [0, 0, 1], [1, 1, 0], 'R', 3],
  ['D-face front edge dragged right turns F prime', [0, -1, 0], [1, 0, 0], [0, -1, 1], 'F', 3],
  ['F-face top edge dragged right turns U prime', [0, 0, 1], [1, 0, 0], [0, 1, 1], 'U', 3],
  ['L-face front edge dragged up turns F', [-1, 0, 0], [0, 1, 0], [-1, 0, 1], 'F', 1],
  ['B-face top edge dragged right turns U', [0, 0, -1], [1, 0, 0], [0, 1, -1], 'U', 1],
  ['R-face top edge dragged forward turns U', [1, 0, 0], [0, 0, 1], [1, 1, 0], 'U', 1],
];

describe('resolveDragTurn', () => {
  it.each(DOCUMENTED)('%s', (_label, normal, drag, cubeletPos, face, turns) => {
    expect(resolveDragTurn(normal, drag, cubeletPos)).toEqual({ face, turns });
  });

  it('rejects a face-centre sticker (would need a slice turn)', () => {
    expect(resolveDragTurn([0, 1, 0], [1, 0, 0], [0, 1, 0])).toBeNull();
  });

  it('rejects an edge sticker dragged along the slice direction', () => {
    // UR edge sticker on U face: dragging along x would turn the z=0 slice.
    expect(resolveDragTurn([0, 1, 0], [1, 0, 0], [1, 1, 0])).toBeNull();
  });

  it('rejects a drag too small to read', () => {
    expect(resolveDragTurn([0, 1, 0], [1e-9, 0, 0], [0, 1, 1])).toBeNull();
  });

  it('rejects a drag straight into the face (projects to nothing)', () => {
    expect(resolveDragTurn([0, 1, 0], [0, 3, 0], [0, 1, 1])).toBeNull();
  });

  it('ignores the component of a drag along the face normal', () => {
    // Same gesture as the documented F case with extra normal pull mixed in.
    expect(resolveDragTurn([0, 1, 0], [2, 0.5, 0], [0, 1, 1])).toEqual({ face: 'F', turns: 1 });
  });

  it('every resolved turn initially moves the sticker along the drag direction', () => {
    // Cross-check axis, layer and direction against the real engine for every
    // draggable sticker of every face, in both in-plane directions. The
    // invariant is about the sticker's initial motion (the tangent of the turn
    // arc), not the cubelet's chord displacement over the full quarter turn,
    // which can end up perpendicular to the drag for corner cubelets.
    for (const face of FACE_LETTERS) {
      const { normal, axis, sign } = FACE_AXES[face];
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const planeAxes = (['x', 'y', 'z'] as AxisName[]).filter((a) => a !== axis);
      for (const cubelet of new CubeState().all()) {
        if (cubelet.home[axisIndex] !== sign) continue;
        if (!isDraggableSticker(cubelet.home)) continue;
        for (const planeAxis of planeAxes) {
          for (const dir of [1, -1] as const) {
            const drag = [0, 0, 0];
            drag[planeAxis === 'x' ? 0 : planeAxis === 'y' ? 1 : 2] = dir;
            const dragVec: Vec3 = [drag[0], drag[1], drag[2]];
            const move = resolveDragTurn(normal, dragVec, cubelet.home);
            // Dragging along plane axis p rotates about the other plane axis
            // p'; an edge cubelet whose coordinate on p' is zero would need a
            // middle-slice turn, so null is the correct answer there.
            const dragIndex = planeAxis === 'x' ? 0 : planeAxis === 'y' ? 1 : 2;
            const crossIndex = 3 - axisIndex - dragIndex;
            if (move === null) {
              expect(cubelet.home[crossIndex]).toBe(0);
              continue;
            }
            expect(cubelet.home[crossIndex]).not.toBe(0);

            // Visual angle sign about the positive axis, per the move
            // convention in startTurn: quarters * 90 * -faceSign.
            const { axis: moveAxis, sign: moveSign } = FACE_AXES[move!.face];
            const quarters = move!.turns === 1 ? 1 : move!.turns === 3 ? -1 : 2;
            const angleSign = quarters * -moveSign;
            const moveAxisIndex = moveAxis === 'x' ? 0 : moveAxis === 'y' ? 1 : 2;

            // Tangent of the sticker's arc: angleSign * (axis x position).
            const p = cubelet.home;
            const tangent: number[] = [0, 0, 0];
            tangent[(moveAxisIndex + 1) % 3] = angleSign * -p[(moveAxisIndex + 2) % 3];
            tangent[(moveAxisIndex + 2) % 3] = angleSign * p[(moveAxisIndex + 1) % 3];

            const dot =
              tangent[0] * drag[0] + tangent[1] * drag[1] + tangent[2] * drag[2];
            expect(dot).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe('isDraggableSticker', () => {
  it('accepts corners and edges, rejects centres and the core', () => {
    expect(isDraggableSticker([1, 1, 1])).toBe(true);
    expect(isDraggableSticker([1, 1, 0])).toBe(true);
    expect(isDraggableSticker([0, 1, 0])).toBe(false);
    expect(isDraggableSticker([0, 0, 0])).toBe(false);
  });
});

describe('stickerWorldNormal', () => {
  it('carries a local normal to world space through the cubelet rotation', () => {
    const state = new CubeState();
    state.applyMoves([{ face: 'U', turns: 1 }]);
    // The U layer rotated -90 degrees about +y: the F sticker normal of the
    // UF edge (0,1,1) becomes +x... verify against engine geometry: U sends
    // front to left, so a sticker that faced front now faces left (-x).
    const cubie = state.all().find((c) => c.home[0] === 0 && c.home[1] === 1 && c.home[2] === 1)!;
    const world = stickerWorldNormal(cubie.rotation, [0, 0, 1]);
    expect(world).toEqual([-1, 0, 0]);
  });
});
