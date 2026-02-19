import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { useConfig } from '@/hooks/use-config'
import { useUiStore, type TabId } from '@/stores/ui'
import { IntersectionsTab } from '@/components/intersections'
import { PlaylistsTab } from '@/components/playlists'
import { SetsTab } from '@/components/sets'
import { TaggerTab } from '@/components/tagger'
import { TreesTab } from '@/components/trees'

const TABS: { id: TabId; label: string }[] = [
  { id: 'set-workshop', label: 'Set Workshop' },
  { id: 'sets', label: 'Sets' },
  { id: 'tagger', label: 'Tagger' },
  { id: 'intersections', label: 'Intersections' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'trees', label: 'Trees' },
  { id: 'phases', label: 'Phases' },
  { id: 'auto-set', label: 'Auto Set' },
  { id: 'chat', label: 'Chat' },
]

function TabPlaceholder({ id }: { id: TabId }) {
  const tab = TABS.find((t) => t.id === id)
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-muted-foreground text-lg">{tab?.label} — coming soon</p>
    </div>
  )
}

function App() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const { isError } = useConfig()

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="flex h-full flex-col"
      >
        <header className="border-b border-border bg-card px-2">
          <TabsList variant="line" className="h-10 gap-0">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="px-3 text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {isError && <p className="text-destructive px-3 py-1 text-xs">Backend unavailable</p>}
        </header>

        <main className="flex flex-1 overflow-hidden">
          {TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="flex flex-1">
              {tab.id === 'tagger' ? (
                <TaggerTab />
              ) : tab.id === 'sets' ? (
                <SetsTab />
              ) : tab.id === 'playlists' ? (
                <PlaylistsTab />
              ) : tab.id === 'intersections' ? (
                <IntersectionsTab />
              ) : tab.id === 'trees' ? (
                <TreesTab />
              ) : (
                <TabPlaceholder id={tab.id} />
              )}
            </TabsContent>
          ))}
        </main>
      </Tabs>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}

export default App
