/** Catmull-Rom spline + energy wave path generation for Set Workshop SVG. */

interface Point {
  x: number
  y: number
}

/**
 * Generate an SVG path string using Catmull-Rom interpolation.
 * @param points Array of {x, y} points
 * @param tension Controls curve tightness (0 = straight, 1 = very curved). Default 0.3
 */
export function catmullRomPath(points: Point[], tension: number = 0.3): string {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`

  const d: string[] = [`M${points[0].x},${points[0].y}`]

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3

    d.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`)
  }

  return d.join(' ')
}

/** Tension values for the 6 layered energy wave paths. */
export const WAVE_TENSIONS = [0.3, 0.25, 0.35, 0.22, 0.38, 0.18] as const

/** Opacity values for the 6 layered energy wave paths. */
export const WAVE_OPACITIES = [1, 0.4, 0.3, 0.2, 0.15, 0.1] as const

/** Stroke widths for the 6 layered paths. */
export const WAVE_WIDTHS = [2, 1.5, 1.5, 1, 1, 0.5] as const

/**
 * Generate fill path (closed area under the curve) for the primary energy wave.
 */
export function fillPath(curvePath: string, startX: number, endX: number, bottomY: number): string {
  if (!curvePath) return ''
  return `${curvePath}L${endX},${bottomY}L${startX},${bottomY}Z`
}
