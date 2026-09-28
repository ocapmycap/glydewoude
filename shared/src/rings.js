/**
 * Ring-crossing math for puzzle courses (LAN-547). Pure geometry: given a
 * flight segment and a ring (a disc floating in space), decide whether the
 * segment passed through it.
 */

/**
 * @typedef {object} Ring
 * @property {{x: number, y: number, z: number}} center
 * @property {{x: number, y: number, z: number}} normal  unit vector
 * @property {number} radius  metres
 */

/**
 * Does the segment from `from` to `to` pass forward through `ring`?
 *
 * @param {{x: number, y: number, z: number}} from
 * @param {{x: number, y: number, z: number}} to
 * @param {Ring} ring
 * @returns {boolean}
 */
export function crossesRing(from, to, ring) {
  const { center, normal, radius } = ring;
  const d0 = (from.x - center.x) * normal.x
    + (from.y - center.y) * normal.y
    + (from.z - center.z) * normal.z;
  const d1 = (to.x - center.x) * normal.x
    + (to.y - center.y) * normal.y
    + (to.z - center.z) * normal.z;

  // Half-open so a step landing exactly on the plane counts once, and the
  // next fixed step starting from that same point does not count it again.
  if (!(d0 < 0 && d1 >= 0)) {
    return false;
  }

  const t = d0 / (d0 - d1);
  const px = from.x + t * (to.x - from.x);
  const py = from.y + t * (to.y - from.y);
  const pz = from.z + t * (to.z - from.z);

  const dx = px - center.x;
  const dy = py - center.y;
  const dz = pz - center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}
