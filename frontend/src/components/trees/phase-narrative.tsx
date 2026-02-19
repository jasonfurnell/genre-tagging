const PHASE_NARRATIVES: Record<string, { title: string; body: string }> = {
  intersection_matrix: {
    title: 'Finding natural clusters',
    body: "Your Genre tree organises tracks by musical lineage — House, Techno, Breaks. Your Scene tree organises by cultural moment — Berlin Minimal, Balearic Summers. Right now, we're cross-referencing every leaf from both trees to find tracks that live at the intersection of both a genre identity and a cultural context. These intersections reveal natural clusters — groups of tracks that share something deeper than just a genre label.",
  },
  cluster_naming: {
    title: 'Giving each cluster its identity',
    body: 'Each intersection is now a seed cluster — a group of tracks that share both a genre lineage and a cultural scene. We\'re sending sample tracks from each cluster to the LLM, asking it to listen to the pattern and give it a name that captures the vibe: not just "Deep House" but something like "Late-Night Tokyo Micro-House" or "Berlin Dub Techno After-Hours". The LLM also scores each cluster\'s coherence and flags tracks that don\'t quite fit.',
  },
  reassignment: {
    title: 'Making sure every track finds its home',
    body: "Some tracks appeared in multiple seed clusters (a track can sit at the intersection of several genre/scene pairs). Others weren't in any cluster at all. This phase resolves that: every track gets assigned to exactly one cluster. We run multiple passes — each time, the LLM looks at orphaned or poorly-fit tracks and finds them a better home. We stop when less than 5% of tracks are moving between passes.",
  },
  quality_scoring: {
    title: 'Refining the collection',
    body: 'Now we quality-check every cluster. The LLM scores each one for coherence — do these tracks actually belong together? Clusters that are too similar get merged. Clusters that are too diverse or too large get split into more focused sub-groups. This iterates up to three times, converging toward ~150 tightly-curated collections where every cluster scores 7/10 or higher.',
  },
  grouping: {
    title: 'Organising into browsable categories',
    body: 'With ~150 refined clusters, we now need a way to browse them. The LLM groups related clusters into 8-12 top-level categories — like a world-class record store organising its sections. The grouping is bottom-up: based on shared musical DNA, cultural affinity, and dancefloor energy rather than rigid genre boundaries.',
  },
  final_descriptions: {
    title: 'Writing the liner notes',
    body: 'Each collection now gets the full treatment: a rich, evocative description that captures the sound, the cultural moment, and what connects these tracks beyond simple genre labels. The LLM also picks 7 exemplar tracks per collection — the most representative tracks that best capture the essence of that particular corner of your music library.',
  },
  enrichment: {
    title: 'Suggesting metadata improvements',
    body: 'The final phase looks at each track in the context of its collection and suggests ways to improve your metadata: more specific sub-genres, scene tags you might be missing, production descriptors, or more precise era information. These suggestions are saved for your review — nothing is changed automatically. Only high-confidence suggestions (70%+) are kept.',
  },
  complete: {
    title: 'Collection built!',
    body: 'Your collection tree is ready to explore. Every track has been assigned to exactly one collection, grouped into browsable categories. You can create playlists from any collection, push them to the Set Workshop, or review the metadata suggestions.',
  },
}

interface PhaseNarrativeProps {
  phase: string | null
}

export function PhaseNarrative({ phase }: PhaseNarrativeProps) {
  if (!phase) return null
  const narrative = PHASE_NARRATIVES[phase]
  if (!narrative) return null

  return (
    <div
      key={phase}
      className="border-primary/30 bg-primary/5 animate-in fade-in mt-3 rounded-md border-l-[3px] px-4 py-3 duration-300"
    >
      <h4 className="text-sm font-semibold">{narrative.title}</h4>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{narrative.body}</p>
    </div>
  )
}
