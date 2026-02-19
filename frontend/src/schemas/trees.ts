import { z } from 'zod'

// ── Tree types ──────────────────────────────────────────────

export const TreeType = z.enum(['genre', 'scene', 'collection'])
export type TreeType = z.infer<typeof TreeType>

// ── Exemplar track ──────────────────────────────────────────

export const ExemplarTrack = z.object({
  artist: z.string(),
  title: z.string(),
  year: z.union([z.string(), z.number()]).nullable().optional(),
})
export type ExemplarTrack = z.infer<typeof ExemplarTrack>

// ── Recursive tree node (genre/scene) ───────────────────────

interface TreeNodeShape {
  id: string
  title: string
  subtitle?: string
  description?: string
  track_count: number
  track_ids?: number[]
  examples?: Array<{ artist: string; title: string; year?: string | number | null }>
  is_leaf?: boolean
  filters?: Record<string, unknown>
  children?: TreeNodeShape[]
}

export const TreeNode: z.ZodType<TreeNodeShape> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    track_count: z.number(),
    track_ids: z.array(z.number()).optional(),
    examples: z.array(ExemplarTrack).optional(),
    is_leaf: z.boolean().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    children: z.array(TreeNode).optional(),
  }),
)
export type TreeNode = z.infer<typeof TreeNode>

// ── Hierarchical tree (genre/scene) ─────────────────────────

export const HierarchicalTree = z.object({
  lineages: z.array(TreeNode),
  ungrouped_track_ids: z.array(z.number()).optional(),
  total_tracks: z.number(),
  assigned_tracks: z.number(),
  status: z.string().optional(),
})
export type HierarchicalTree = z.infer<typeof HierarchicalTree>

// ── Collection tree (flat 2-level) ──────────────────────────

export const CollectionLeaf = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  track_count: z.number(),
  track_ids: z.array(z.number()).optional(),
  examples: z.array(ExemplarTrack).optional(),
  genre_context: z.string().optional(),
  scene_context: z.string().optional(),
  metadata_suggestions: z.array(z.record(z.string(), z.unknown())).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
})
export type CollectionLeaf = z.infer<typeof CollectionLeaf>

export const CollectionCategory = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  track_count: z.number(),
  leaves: z.array(CollectionLeaf).optional(),
})
export type CollectionCategory = z.infer<typeof CollectionCategory>

export const CollectionTree = z.object({
  categories: z.array(CollectionCategory),
  total_tracks: z.number(),
  assigned_tracks: z.number(),
  status: z.string().optional(),
})
export type CollectionTree = z.infer<typeof CollectionTree>

// ── API responses ───────────────────────────────────────────

export const HierarchicalTreeResponse = z.object({
  tree: HierarchicalTree.nullable(),
})
export type HierarchicalTreeResponse = z.infer<typeof HierarchicalTreeResponse>

export const CollectionTreeResponse = z.object({
  tree: CollectionTree.nullable(),
  has_checkpoint: z.boolean().optional(),
  checkpoint_phase: z.number().optional(),
})
export type CollectionTreeResponse = z.infer<typeof CollectionTreeResponse>

export const UngroupedResponse = z.object({
  count: z.number(),
  tracks: z.array(z.record(z.string(), z.unknown())),
})
export type UngroupedResponse = z.infer<typeof UngroupedResponse>

export const TreePlaylistResponse = z.object({
  playlist: z.record(z.string(), z.unknown()),
  method: z.string().optional(),
})
export type TreePlaylistResponse = z.infer<typeof TreePlaylistResponse>

export const TreeAllPlaylistsResponse = z.object({
  playlists: z.array(z.record(z.string(), z.unknown())),
  count: z.number(),
})
export type TreeAllPlaylistsResponse = z.infer<typeof TreeAllPlaylistsResponse>
