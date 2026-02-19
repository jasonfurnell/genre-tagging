import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DeleteTreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  typeName: string
  onConfirm: () => void
}

export function DeleteTreeDialog({
  open,
  onOpenChange,
  typeName,
  onConfirm,
}: DeleteTreeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rebuild {typeName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete the current {typeName.toLowerCase()} and start a fresh build. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete &amp; Rebuild</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
