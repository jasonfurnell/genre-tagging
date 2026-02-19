import { useCallback, useMemo, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, type ColDef, type CellValueChangedEvent } from 'ag-grid-community'
import { themeQuartz, colorSchemeDarkBlue } from 'ag-grid-community'
import type { TrackRow } from '@/schemas'
import { Button } from '@/components/ui/button'
import { useRetagTrack, useUpdateTrackComment, useClearTrack } from '@/hooks/use-tagger'

interface TrackGridProps {
  tracks: TrackRow[]
}

function ActionsCell({ data }: { data: TrackRow }) {
  const retag = useRetagTrack()
  const clear = useClearTrack()

  return (
    <div className="flex items-center gap-1 py-1">
      <img
        src={`/artwork/${data.artist}||${data.title}`}
        alt=""
        className="h-10 w-10 rounded object-cover"
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      <Button
        variant="ghost"
        size="xs"
        onClick={() => retag.mutate(data.id)}
        disabled={retag.isPending}
      >
        {retag.isPending ? '...' : 'Re-tag'}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => clear.mutate(data.id)}
        disabled={clear.isPending}
      >
        Clear
      </Button>
    </div>
  )
}

const darkTheme = themeQuartz.withPart(colorSchemeDarkBlue)

export function TrackGrid({ tracks }: TrackGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const updateComment = useUpdateTrackComment()

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
      { field: 'title', minWidth: 140, flex: 1 },
      { field: 'artist', minWidth: 140, flex: 1 },
      { field: 'bpm', width: 75 },
      { field: 'key', width: 75 },
      { field: 'year', width: 80 },
      {
        field: 'comment',
        minWidth: 200,
        flex: 2,
        editable: true,
        autoHeight: true,
        wrapText: true,
        cellStyle: { whiteSpace: 'normal', lineHeight: '1.4' },
      },
      {
        headerName: 'Actions',
        cellRenderer: ActionsCell,
        width: 200,
        sortable: false,
        filter: false,
        resizable: false,
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

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<TrackRow>) => {
      if (event.colDef.field === 'comment' && event.data) {
        updateComment.mutate({
          trackId: event.data.id,
          comment: event.newValue ?? '',
        })
      }
    },
    [updateComment],
  )

  const rowClassRules = useMemo(
    () => ({
      'ag-row-untagged': (params: { data?: TrackRow }) => params.data?.status === 'untagged',
    }),
    [],
  )

  return (
    <div className="flex-1">
      <AgGridReact<TrackRow>
        ref={gridRef}
        theme={darkTheme}
        modules={[AllCommunityModule]}
        rowData={tracks}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        rowHeight={64}
        domLayout="autoHeight"
        rowClassRules={rowClassRules}
        onCellValueChanged={onCellValueChanged}
        enableCellTextSelection
      />
    </div>
  )
}
