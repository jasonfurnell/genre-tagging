import { useCallback, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, type ColDef } from 'ag-grid-community'
import { themeQuartz, colorSchemeDarkBlue } from 'ag-grid-community'
import { Input } from '@/components/ui/input'
import { useTracks } from '@/hooks/use-tracks'
import type { TrackRow } from '@/schemas'

const darkTheme = themeQuartz.withPart(colorSchemeDarkBlue)

export function TracksTab() {
  const { data: tracks, isLoading } = useTracks()
  const gridRef = useRef<AgGridReact>(null)
  const [quickFilter, setQuickFilter] = useState('')

  const columnDefs = useMemo<ColDef<TrackRow>[]>(
    () => [
      {
        headerName: '#',
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
        width: 55,
        resizable: false,
        sortable: false,
        suppressMovable: true,
        filter: false,
      },
      {
        headerName: '',
        width: 50,
        resizable: false,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data: TrackRow }) =>
          data ? (
            <img
              src={`/artwork/${data.artist}||${data.title}`}
              alt=""
              className="h-8 w-8 rounded object-cover"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null,
      },
      { field: 'title', minWidth: 140, flex: 1 },
      { field: 'artist', minWidth: 140, flex: 1 },
      { field: 'bpm', width: 70 },
      { field: 'key', width: 65 },
      { field: 'year', width: 70 },
      { field: 'genre1', headerName: 'Genre 1', minWidth: 100, flex: 1 },
      { field: 'genre2', headerName: 'Genre 2', minWidth: 100, flex: 1 },
      { field: 'mood', minWidth: 100, flex: 1 },
      { field: 'descriptors', minWidth: 120, flex: 1 },
      { field: 'era', width: 80 },
      {
        field: 'comment',
        minWidth: 200,
        flex: 2,
        autoHeight: true,
        wrapText: true,
        cellStyle: { whiteSpace: 'normal', lineHeight: '1.4' },
      },
    ],
    [],
  )

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
    }),
    [],
  )

  const getRowId = useCallback((params: { data: TrackRow }) => String(params.data.id), [])

  const onFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuickFilter(e.target.value)
  }, [])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading tracks...</p>
      </div>
    )
  }

  if (!tracks || tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">No tracks loaded. Upload a CSV in the Tagger tab.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground text-sm">{tracks.length} tracks</span>
        <Input
          placeholder="Filter tracks..."
          value={quickFilter}
          onChange={onFilterChange}
          className="max-w-xs"
        />
      </div>

      <div className="flex-1">
        <AgGridReact<TrackRow>
          ref={gridRef}
          theme={darkTheme}
          modules={[AllCommunityModule]}
          rowData={tracks}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          rowHeight={48}
          domLayout="autoHeight"
          quickFilterText={quickFilter}
          enableCellTextSelection
        />
      </div>
    </div>
  )
}
