import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  HierarchicalTreeResponse,
  CollectionTreeResponse,
  UngroupedResponse,
  TreePlaylistResponse,
  TreeAllPlaylistsResponse,
} from '@/schemas'
import type { TreeType } from '@/schemas'

const API_PREFIX: Record<TreeType, string> = {
  genre: '/api/tree',
  scene: '/api/scene-tree',
  collection: '/api/collection-tree',
}

export const treeKeys = {
  genre: ['tree', 'genre'] as const,
  scene: ['tree', 'scene'] as const,
  collection: ['tree', 'collection'] as const,
  ungrouped: (type: TreeType) => ['tree', type, 'ungrouped'] as const,
}

// ── Fetch tree data ─────────────────────────────────────────

export function useGenreTree() {
  return useQuery({
    queryKey: treeKeys.genre,
    queryFn: () => api.get(API_PREFIX.genre).then(api.validated(HierarchicalTreeResponse)),
  })
}

export function useSceneTree() {
  return useQuery({
    queryKey: treeKeys.scene,
    queryFn: () => api.get(API_PREFIX.scene).then(api.validated(HierarchicalTreeResponse)),
  })
}

export function useCollectionTree() {
  return useQuery({
    queryKey: treeKeys.collection,
    queryFn: () => api.get(API_PREFIX.collection).then(api.validated(CollectionTreeResponse)),
  })
}

// ── Build ───────────────────────────────────────────────────

export function useBuildTree(type: TreeType) {
  return useMutation({
    mutationFn: (opts?: { test?: boolean }) => {
      const params = opts?.test ? '?test=1' : ''
      return api.post<{ started: boolean }>(`${API_PREFIX[type]}/build${params}`)
    },
  })
}

// ── Stop ────────────────────────────────────────────────────

export function useStopTreeBuild(type: TreeType) {
  return useMutation({
    mutationFn: () => api.post<{ stopped: boolean }>(`${API_PREFIX[type]}/stop`),
  })
}

// ── Delete ──────────────────────────────────────────────────

export function useDeleteTree(type: TreeType) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(API_PREFIX[type]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: treeKeys[type] })
    },
  })
}

// ── Expand ungrouped (genre/scene only) ─────────────────────

export function useExpandUngrouped(type: TreeType) {
  return useMutation({
    mutationFn: () =>
      api.post<{ started: boolean; ungrouped_count: number }>(
        `${API_PREFIX[type]}/expand-ungrouped`,
      ),
  })
}

// ── Refresh examples (genre/scene only) ─────────────────────

export function useRefreshExamples(type: TreeType) {
  return useMutation({
    mutationFn: () => api.post<{ started: boolean }>(`${API_PREFIX[type]}/refresh-examples`),
  })
}

// ── Ungrouped tracks ────────────────────────────────────────

export function useUngroupedTracks(type: TreeType, enabled: boolean) {
  return useQuery({
    queryKey: treeKeys.ungrouped(type),
    queryFn: () => api.get(`${API_PREFIX[type]}/ungrouped`).then(api.validated(UngroupedResponse)),
    enabled,
  })
}

// ── Create playlist from node ───────────────────────────────

export function useCreateTreePlaylist(type: TreeType) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) =>
      api
        .post(`${API_PREFIX[type]}/create-playlist`, { node_id: nodeId })
        .then(api.validated(TreePlaylistResponse)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
    },
  })
}

// ── Create all playlists ────────────────────────────────────

export function useCreateAllTreePlaylists(type: TreeType) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api
        .post(`${API_PREFIX[type]}/create-all-playlists`)
        .then(api.validated(TreeAllPlaylistsResponse)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
    },
  })
}

// ── Helpers ─────────────────────────────────────────────────

export function progressUrl(type: TreeType): string {
  return `${API_PREFIX[type]}/progress`
}

export function exportM3uUrl(type: TreeType, nodeId: string): string {
  return `${API_PREFIX[type]}/node/${nodeId}/export/m3u`
}
