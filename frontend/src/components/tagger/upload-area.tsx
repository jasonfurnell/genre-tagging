import { useCallback, useRef, useState } from 'react'

interface UploadAreaProps {
  onUpload: (file: File) => void
  isUploading: boolean
}

export function UploadArea({ onUpload, isUploading }: UploadAreaProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith('.csv')) onUpload(file)
    },
    [onUpload],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onUpload(file)
      e.target.value = ''
    },
    [onUpload],
  )

  return (
    <div
      className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <p className="text-muted-foreground text-sm">
        {isUploading ? (
          'Uploading...'
        ) : (
          <>
            Drag & drop a CSV file here, or{' '}
            <span className="text-primary cursor-pointer underline">browse</span>
          </>
        )}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
