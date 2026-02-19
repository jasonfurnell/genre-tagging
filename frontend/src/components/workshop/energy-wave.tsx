import { memo } from 'react'
import {
  catmullRomPath,
  fillPath,
  WAVE_TENSIONS,
  WAVE_OPACITIES,
  WAVE_WIDTHS,
} from '@/lib/energy-wave'

interface EnergyWaveProps {
  points: { x: number; y: number }[]
  width: number
  height: number
  offsetY: number
}

export const EnergyWave = memo(function EnergyWave({
  points,
  width,
  height,
  offsetY,
}: EnergyWaveProps) {
  if (points.length < 2) return null

  const primaryPath = catmullRomPath(points, WAVE_TENSIONS[0])
  const fill = fillPath(primaryPath, points[0].x, points[points.length - 1].x, height)

  return (
    <svg
      className="pointer-events-none absolute left-0"
      style={{ top: offsetY, width, height }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {/* Fill under primary curve */}
      <path d={fill} fill="hsl(var(--primary) / 0.06)" />

      {/* Layered paths (ghost → primary) */}
      {WAVE_TENSIONS.map((tension, i) => {
        if (i === 0) return null // primary drawn last
        const d = catmullRomPath(points, tension)
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={WAVE_WIDTHS[i]}
            opacity={WAVE_OPACITIES[i]}
          />
        )
      }).reverse()}

      {/* Primary curve */}
      <path
        d={primaryPath}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={WAVE_WIDTHS[0]}
        opacity={WAVE_OPACITIES[0]}
      />
    </svg>
  )
})
