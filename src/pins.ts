type Point = { x: number; y: number };

/** Groups stop indexes whose pins would overlap on screen, so a nearby stop never hides another's number. */
export function groupPins(points: (Point | null)[], radius: number): number[][] {
  const groups: (Point & { indexes: number[] })[] = [];
  points.forEach((point, index) => {
    if (!point) return;
    const near = groups.find((group) => Math.hypot(group.x - point.x, group.y - point.y) < radius);
    if (near) near.indexes.push(index);
    else groups.push({ ...point, indexes: [index] });
  });
  return groups.map((group) => group.indexes);
}
