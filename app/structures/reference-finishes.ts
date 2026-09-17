import type { Point } from "./plan";

export type Fixture = {
  id: string;
  roomId: string;
  kind: "toilet" | "basin" | "tub" | "counter" | "sink" | "cooktop";
  center: Point;
  width: number;
  depth: number;
  rotation: number;
};
const scale = 12.57 / 349;
// Source-image pixel footprints. Heights and materials are illustrative, not measured.
const fixture = (
  id: string,
  roomId: string,
  kind: Fixture["kind"],
  x: number,
  y: number,
  w: number,
  d: number,
  rotation = 0,
): Fixture => ({
  id,
  roomId,
  kind,
  center: [(x - 126) * scale, (400 - y) * scale],
  width: w * scale,
  depth: d * scale,
  rotation,
});
export const REFERENCE_FIXTURES: Fixture[] = [
  fixture("master-tub", "bath-master", "tub", 151, 128, 37, 17),
  fixture("master-basin", "bath-master", "basin", 139, 151, 16, 15, 90),
  fixture("master-toilet", "bath-master", "toilet", 139, 176, 13, 20, 90),
  fixture("common-tub", "bath-common", "tub", 411, 141, 37, 16),
  fixture("common-basin", "bath-common", "basin", 426, 162, 15, 15, -90),
  fixture("common-toilet", "bath-common", "toilet", 425, 183, 13, 19, -90),
  fixture("counter-back", "kitchen", "counter", 305, 104, 59, 18),
  fixture("counter-side", "kitchen", "counter", 328, 178, 17, 33),
  fixture("kitchen-sink", "kitchen", "sink", 300, 104, 18, 14),
  fixture("kitchen-cooktop", "kitchen", "cooktop", 328, 175, 14, 23),
];
export type Finish = "bath" | "balcony" | "wood" | "bedroom" | "entry";
export function referenceFinish(roomId: string): Finish {
  if (roomId.startsWith("bath-")) return "bath";
  if (roomId.startsWith("balcony-")) return "balcony";
  if (roomId === "living" || roomId === "kitchen") return "wood";
  if (roomId === "entrance") return "entry";
  return "bedroom";
}
// Never apply guessed fixtures to uploaded plans or other units with similar room IDs.
