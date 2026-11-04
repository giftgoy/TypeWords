/** Assign overlapping glosses to successive 12px lanes within each text line. */
export function annotationLanes(rects: { top: number; left: number; right: number }[]): number[] {
  let lineTop = -Infinity
  let lanes: number[] = []
  return rects.map(rect => {
    if (Math.abs(rect.top - lineTop) >= 4) {
      lineTop = rect.top
      lanes = []
    }
    let lane = lanes.findIndex(right => rect.left >= right + 2)
    if (lane === -1) lane = lanes.length
    lanes[lane] = rect.right
    return lane
  })
}
