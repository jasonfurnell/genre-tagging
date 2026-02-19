import { useRef, useEffect, useState, useCallback } from 'react'
import { chord as d3chord, ribbon as d3ribbon } from 'd3-chord'
import type { Chord, ChordGroup, ChordSubgroup } from 'd3-chord'
import { arc as d3arc } from 'd3-shape'
import { select } from 'd3-selection'
import { descending } from 'd3-array'
import type { ChordDataResponse, ChordLineage } from '@/schemas'

const CHORD_COLORS = [
  '#4ecca3',
  '#e94560',
  '#6c5ce7',
  '#fdcb6e',
  '#00b894',
  '#e17055',
  '#0984e3',
  '#fab1a0',
  '#74b9ff',
  '#a29bfe',
  '#55efc4',
  '#fd79a8',
  '#00cec9',
  '#ffeaa7',
  '#dfe6e9',
  '#b2bec3',
  '#636e72',
  '#81ecec',
  '#ff7675',
  '#fd79a8',
]

function abbreviate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

interface ChordDiagramProps {
  data: ChordDataResponse
  onRibbonClick: (
    lineage1: ChordLineage,
    lineage2: ChordLineage,
    sharedCount: number,
    event: MouseEvent,
  ) => void
}

export function ChordDiagram({ data, onRibbonClick }: ChordDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Reset selection when data changes
  useEffect(() => {
    setSelectedIndex(null)
  }, [data])

  const handleRibbonClick = useCallback(
    (lineage1: ChordLineage, lineage2: ChordLineage, sharedCount: number, event: MouseEvent) => {
      onRibbonClick(lineage1, lineage2, sharedCount, event)
    },
    [onRibbonClick],
  )

  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!container || !tooltip) return

    const { lineages, matrix } = data
    if (!lineages || lineages.length === 0 || !matrix) {
      container.innerHTML =
        '<p class="text-muted-foreground text-center text-sm py-8">No lineage data available.</p>'
      return
    }

    // Check if any chords exist (off-diagonal > 0)
    let hasChords = false
    for (let i = 0; i < matrix.length && !hasChords; i++)
      for (let j = 0; j < matrix.length && !hasChords; j++)
        if (i !== j && matrix[i][j] > 0) hasChords = true

    if (!hasChords) {
      container.innerHTML =
        '<p class="text-muted-foreground text-center text-sm py-8">No cross-lineage connections at this threshold. Try lowering the DNA Threshold slider.</p>'
      return
    }

    // Clear previous render
    container.innerHTML = ''

    const width = Math.min(container.clientWidth || 800, 850)
    const height = width
    const outerRadius = width / 2 - 100
    const innerRadius = outerRadius - 20

    const svg = select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`)

    const chordLayout = d3chord().padAngle(0.04).sortSubgroups(descending)
    const chords = chordLayout(matrix)

    const arc = d3arc<ChordGroup>().innerRadius(innerRadius).outerRadius(outerRadius)
    const ribbon = d3ribbon<Chord, ChordSubgroup>().radius(innerRadius)

    // Current selection index (mutable for D3 event handlers)
    let selIdx = selectedIndex

    function isConnected(r: { source: { index: number }; target: { index: number } }, idx: number) {
      return r.source.index === idx || r.target.index === idx
    }

    function applyVisuals() {
      if (selIdx !== null) {
        ribbons
          .style('fill-opacity', (r: unknown) =>
            isConnected(r as { source: { index: number }; target: { index: number } }, selIdx!)
              ? 0.75
              : 0.04,
          )
          .style('pointer-events', (r: unknown) =>
            isConnected(r as { source: { index: number }; target: { index: number } }, selIdx!)
              ? 'auto'
              : 'none',
          )
        arcPaths
          .style('stroke', (_d: unknown, i: number) => (i === selIdx ? '#fff' : '#1a1a2e'))
          .style('stroke-width', (_d: unknown, i: number) => (i === selIdx ? 2.5 : 1.5))
        labels.style('fill-opacity', (_d: unknown, i: number) => (i === selIdx ? 1 : 0.3))
      } else {
        ribbons.style('fill-opacity', 0.45).style('pointer-events', 'auto')
        arcPaths.style('stroke', '#1a1a2e').style('stroke-width', 1.5)
        labels.style('fill-opacity', 1)
      }
    }

    // Draw ribbons
    const ribbons = svg
      .append('g')
      .selectAll('path')
      .data(chords)
      .join('path')
      .attr('d', ribbon as unknown as string)
      .style('fill', (d) => CHORD_COLORS[d.source.index % CHORD_COLORS.length])
      .style('fill-opacity', 0.45)
      .style('stroke', 'none')
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        if (selIdx !== null && !isConnected(d, selIdx)) return
        select(this).style('fill-opacity', 0.9)
        const l1 = lineages[d.source.index]
        const l2 = lineages[d.target.index]
        const shared = matrix[d.source.index][d.target.index]
        tooltip.innerHTML = `<strong>${escapeHtml(l1.title)}</strong><br>+&nbsp;<strong>${escapeHtml(l2.title)}</strong><br>${shared} shared tracks`
        tooltip.style.display = 'block'
        tooltip.style.left = event.pageX + 14 + 'px'
        tooltip.style.top = event.pageY - 12 + 'px'
      })
      .on('mousemove', function (event: MouseEvent) {
        tooltip.style.left = event.pageX + 14 + 'px'
        tooltip.style.top = event.pageY - 12 + 'px'
      })
      .on('mouseout', function (_event: MouseEvent, d) {
        const base = selIdx !== null ? (isConnected(d, selIdx) ? 0.75 : 0.04) : 0.45
        select(this).style('fill-opacity', base)
        tooltip.style.display = 'none'
      })
      .on('click', function (event: MouseEvent, d) {
        if (selIdx !== null && !isConnected(d, selIdx)) return
        tooltip.style.display = 'none'
        const l1 = lineages[d.source.index]
        const l2 = lineages[d.target.index]
        handleRibbonClick(l1, l2, matrix[d.source.index][d.target.index], event)
      })

    // Draw arcs
    const groups = svg.append('g').selectAll('g').data(chords.groups).join('g')

    const arcPaths = groups
      .append('path')
      .attr('d', arc as unknown as string)
      .style('fill', (d) => CHORD_COLORS[d.index % CHORD_COLORS.length])
      .style('stroke', '#1a1a2e')
      .style('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        if (selIdx !== null) {
          const lin = lineages[d.index]
          tooltip.innerHTML = `<strong>${escapeHtml(lin.title)}</strong><br>${lin.track_count} tracks in tree`
          tooltip.style.display = 'block'
          tooltip.style.left = event.pageX + 14 + 'px'
          tooltip.style.top = event.pageY - 12 + 'px'
          return
        }
        ribbons.style('fill-opacity', (r: unknown) =>
          isConnected(r as { source: { index: number }; target: { index: number } }, d.index)
            ? 0.85
            : 0.06,
        )
        const lin = lineages[d.index]
        tooltip.innerHTML = `<strong>${escapeHtml(lin.title)}</strong><br>${lin.track_count} tracks in tree`
        tooltip.style.display = 'block'
        tooltip.style.left = event.pageX + 14 + 'px'
        tooltip.style.top = event.pageY - 12 + 'px'
      })
      .on('mousemove', function (event: MouseEvent) {
        tooltip.style.left = event.pageX + 14 + 'px'
        tooltip.style.top = event.pageY - 12 + 'px'
      })
      .on('mouseout', function () {
        tooltip.style.display = 'none'
        if (selIdx !== null) return
        ribbons.style('fill-opacity', 0.45)
      })
      .on('click', function (_event: MouseEvent, d) {
        if (selIdx === d.index) {
          selIdx = null
        } else {
          selIdx = d.index
        }
        setSelectedIndex(selIdx)
        applyVisuals()
      })

    // Draw labels
    const labels = groups
      .append('text')
      .each(function (d) {
        ;(d as unknown as { angle: number }).angle = (d.startAngle + d.endAngle) / 2
      })
      .attr('dy', '.35em')
      .attr('transform', (d) => {
        const angle = (d as unknown as { angle: number }).angle
        return `rotate(${(angle * 180) / Math.PI - 90}) translate(${outerRadius + 10}) ${angle > Math.PI ? 'rotate(180)' : ''}`
      })
      .attr('text-anchor', (d) =>
        (d as unknown as { angle: number }).angle > Math.PI ? 'end' : 'start',
      )
      .attr('fill', 'currentColor')
      .attr('font-size', '11px')
      .text((d) => abbreviate(lineages[d.index].title, 30))

    applyVisuals()

    return () => {
      container.innerHTML = ''
    }
  }, [data, selectedIndex, handleRibbonClick])

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full" />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 hidden rounded border border-border bg-card px-2 py-1 text-xs shadow-lg"
      />
    </div>
  )
}
