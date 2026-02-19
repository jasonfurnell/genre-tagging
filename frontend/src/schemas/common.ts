import { z } from 'zod'

export const ErrorResponse = z.object({
  error: z.string(),
})

export const SuccessResponse = z.object({
  ok: z.boolean().optional(),
  started: z.boolean().optional(),
  stopped: z.boolean().optional(),
  track_count: z.number().optional(),
})

export const ProgressEvent = z.object({
  event: z.string(),
  phase: z.string().optional(),
  detail: z.string().optional(),
  percent: z.number().optional(),
  id: z.number().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  comment: z.string().optional(),
  year: z.number().optional(),
  status: z.string().optional(),
  progress: z.string().optional(),
  set_id: z.string().optional(),
  text: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  result_summary: z.string().optional(),
  full_text: z.string().optional(),
})

export const UploadSummary = z.object({
  total: z.number(),
  tagged: z.number(),
  untagged: z.number(),
  columns: z.array(z.string()),
  restored: z.boolean().optional(),
  filename: z.string().optional(),
})

export type ErrorResponse = z.infer<typeof ErrorResponse>
export type SuccessResponse = z.infer<typeof SuccessResponse>
export type ProgressEvent = z.infer<typeof ProgressEvent>
export type UploadSummary = z.infer<typeof UploadSummary>
