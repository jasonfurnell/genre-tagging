import { useMemo, useReducer } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfig, useUpdateConfig } from '@/hooks/use-config'
import type { AppConfig } from '@/schemas'

const MODELS = {
  Anthropic: [
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-haiku-3-5-20241022',
  ],
  OpenAI: ['gpt-4o', 'gpt-4o-mini'],
}

type FormAction =
  | { type: 'reset'; config: AppConfig }
  | { type: 'set'; field: keyof AppConfig; value: string | number | boolean }

function formReducer(state: Partial<AppConfig>, action: FormAction): Partial<AppConfig> {
  switch (action.type) {
    case 'reset':
      return { ...action.config }
    case 'set':
      return { ...state, [action.field]: action.value }
  }
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { data: config } = useConfig()
  const updateConfig = useUpdateConfig()
  const initialForm = useMemo<Partial<AppConfig>>(() => (config ? { ...config } : {}), [config])
  const [form, dispatch] = useReducer(formReducer, initialForm)

  // Reset form to current config when dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && config) dispatch({ type: 'reset', config })
    onOpenChange(nextOpen)
  }

  function handleSave() {
    updateConfig.mutate(form, { onSuccess: () => onOpenChange(false) })
  }

  function handleReset() {
    fetch('/api/config/reset', { method: 'POST' })
      .then((r) => r.json())
      .then((data: AppConfig) => dispatch({ type: 'reset', config: data }))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model</Label>
            <Select
              value={form.model ?? ''}
              onValueChange={(v) => dispatch({ type: 'set', field: 'model', value: v })}
            >
              <SelectTrigger id="model">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODELS).map(([group, models]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="system-prompt">System Prompt</Label>
            <Textarea
              id="system-prompt"
              rows={3}
              value={form.system_prompt ?? ''}
              onChange={(e) =>
                dispatch({ type: 'set', field: 'system_prompt', value: e.target.value })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-prompt">User Prompt Template</Label>
            <Textarea
              id="user-prompt"
              rows={6}
              value={form.user_prompt_template ?? ''}
              onChange={(e) =>
                dispatch({ type: 'set', field: 'user_prompt_template', value: e.target.value })
              }
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              Placeholders: {'{title}'}, {'{artist}'}, {'{bpm}'}, {'{key}'}, {'{year}'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delay">Delay between requests (seconds)</Label>
            <Input
              id="delay"
              type="number"
              step={0.1}
              min={0}
              value={form.delay_between_requests ?? 1.5}
              onChange={(e) =>
                dispatch({
                  type: 'set',
                  field: 'delay_between_requests',
                  value: Number(e.target.value),
                })
              }
              className="w-24"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleReset}>
            Reset Defaults
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
