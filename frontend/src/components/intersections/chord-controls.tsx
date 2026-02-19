import { useCallback } from 'react'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useIntersectionsStore } from '@/stores/intersections'

export function ChordControls() {
  const treeType = useIntersectionsStore((s) => s.treeType)
  const setTreeType = useIntersectionsStore((s) => s.setTreeType)
  const threshold = useIntersectionsStore((s) => s.threshold)
  const setThreshold = useIntersectionsStore((s) => s.setThreshold)
  const maxLineages = useIntersectionsStore((s) => s.maxLineages)
  const setMaxLineages = useIntersectionsStore((s) => s.setMaxLineages)

  const handleThresholdChange = useCallback(
    (val: number[]) => setThreshold(val[0] / 100),
    [setThreshold],
  )

  const handleLineagesChange = useCallback(
    (val: number[]) => setMaxLineages(val[0]),
    [setMaxLineages],
  )

  return (
    <div className="flex flex-wrap items-center gap-6">
      {/* Tree type toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Tree:</span>
        <ToggleGroup
          type="single"
          value={treeType}
          onValueChange={(v) => v && setTreeType(v as 'genre' | 'scene')}
          className="h-7"
        >
          <ToggleGroupItem value="genre" className="h-7 px-3 text-xs">
            Genre
          </ToggleGroupItem>
          <ToggleGroupItem value="scene" className="h-7 px-3 text-xs">
            Scene
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Threshold slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">DNA Threshold:</span>
        <Slider
          value={[Math.round(threshold * 100)]}
          onValueChange={handleThresholdChange}
          min={3}
          max={25}
          step={1}
          className="w-32"
        />
        <span className="w-8 text-xs text-muted-foreground">{Math.round(threshold * 100)}%</span>
      </div>

      {/* Max lineages slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Max Lineages:</span>
        <Slider
          value={[maxLineages]}
          onValueChange={handleLineagesChange}
          min={4}
          max={20}
          step={1}
          className="w-32"
        />
        <span className="w-6 text-xs text-muted-foreground">{maxLineages}</span>
      </div>
    </div>
  )
}
