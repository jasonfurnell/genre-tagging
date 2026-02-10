"""Comment parser, genre normalization, co-occurrence matrix, and faceted search."""

import re
from collections import Counter

import pandas as pd

# ---------------------------------------------------------------------------
# Genre normalization
# ---------------------------------------------------------------------------

_GENRE_ALIASES = {
    "hip hop": "Hip-Hop",
    "hip-hop": "Hip-Hop",
    "r & b": "R&B",
    "r&b": "R&B",
    "rnb": "R&B",
    "drum & bass": "Drum & Bass",
    "drum and bass": "Drum & Bass",
    "dnb": "Drum & Bass",
    "d&b": "Drum & Bass",
}


def normalize_genre(genre):
    """Normalize a genre string for consistent grouping."""
    if not genre or not isinstance(genre, str):
        return ""
    g = genre.strip()
    if not g:
        return ""
    key = g.lower()
    if key in _GENRE_ALIASES:
        return _GENRE_ALIASES[key]
    # Title-case but preserve hyphens and ampersands
    return g


# ---------------------------------------------------------------------------
# Comment parsing
# ---------------------------------------------------------------------------

_ERA_RE = re.compile(
    r",?\s*(early|mid|late|circa)[\s-]+(\d{4}s?(?:\s*[-–]\s*\d{4}s?)?)\s*\.?\s*$",
    re.IGNORECASE,
)


def parse_comment(comment):
    """Parse a semi-structured comment string into facets.

    Returns dict with keys: genre1, genre2, descriptors, mood, location_era,
    location, era.  All values are strings (possibly empty).
    """
    empty = {
        "genre1": "", "genre2": "", "descriptors": "", "mood": "",
        "location_era": "", "location": "", "era": "",
    }
    if not comment or not isinstance(comment, str) or not comment.strip():
        return empty

    parts = [p.strip() for p in comment.split(";")]

    result = dict(empty)
    if len(parts) >= 1:
        result["genre1"] = parts[0]
    if len(parts) >= 2:
        result["genre2"] = parts[1]
    if len(parts) >= 5:
        result["descriptors"] = parts[2]
        result["mood"] = parts[3]
        result["location_era"] = parts[4].rstrip(".")
    elif len(parts) == 4:
        result["descriptors"] = parts[2]
        result["location_era"] = parts[3].rstrip(".")
    elif len(parts) == 3:
        result["descriptors"] = parts[2].rstrip(".")

    # Extract location and era from location_era
    loc_era = result["location_era"]
    if loc_era:
        m = _ERA_RE.search(loc_era)
        if m:
            result["era"] = (m.group(1) + " " + m.group(2)).strip()
            result["location"] = loc_era[:m.start()].strip().rstrip(",").strip()
        else:
            # Try splitting on last comma
            if "," in loc_era:
                parts_le = loc_era.rsplit(",", 1)
                result["location"] = parts_le[0].strip()
                result["era"] = parts_le[1].strip().rstrip(".")
            else:
                result["location"] = loc_era

    return result


# ---------------------------------------------------------------------------
# Batch parsing
# ---------------------------------------------------------------------------

def parse_all_comments(df):
    """Add parsed facet columns (_genre1, _genre2, etc.) to the DataFrame.

    Mutates df in place and returns it.
    """
    if "_genre1" in df.columns:
        return df  # already parsed

    parsed = df["comment"].apply(
        lambda c: parse_comment(c) if pd.notna(c) else parse_comment("")
    )
    df["_genre1"] = parsed.apply(lambda p: normalize_genre(p["genre1"]))
    df["_genre2"] = parsed.apply(lambda p: normalize_genre(p["genre2"]))
    df["_descriptors"] = parsed.apply(lambda p: p["descriptors"])
    df["_mood"] = parsed.apply(lambda p: p["mood"])
    df["_location"] = parsed.apply(lambda p: p["location"])
    df["_era"] = parsed.apply(lambda p: p["era"])
    return df


def invalidate_parsed_columns(df):
    """Remove parsed facet columns so they'll be recomputed on next access."""
    for col in ("_genre1", "_genre2", "_descriptors", "_mood", "_location", "_era"):
        if col in df.columns:
            df.drop(columns=[col], inplace=True)


# ---------------------------------------------------------------------------
# Genre co-occurrence matrix
# ---------------------------------------------------------------------------

def build_genre_cooccurrence(df, top_n=30):
    """Build a genre co-occurrence matrix from parsed facet columns.

    Returns {genres: [str], matrix: [[int]], totals: {str: int}}.
    """
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    # Count individual genre appearances
    all_genres = pd.concat([df["_genre1"], df["_genre2"]])
    all_genres = all_genres[all_genres != ""]
    genre_counts = Counter(all_genres)

    # Take top N genres
    top_genres = [g for g, _ in genre_counts.most_common(top_n)]
    genre_set = set(top_genres)
    genre_index = {g: i for i, g in enumerate(top_genres)}

    n = len(top_genres)
    matrix = [[0] * n for _ in range(n)]

    for _, row in df.iterrows():
        g1 = row["_genre1"]
        g2 = row["_genre2"]
        if g1 in genre_set and g2 in genre_set and g1 != g2:
            i, j = genre_index[g1], genre_index[g2]
            matrix[i][j] += 1
            matrix[j][i] += 1

    # Diagonal = total count for that genre
    for g in top_genres:
        i = genre_index[g]
        matrix[i][i] = genre_counts[g]

    return {
        "genres": top_genres,
        "matrix": matrix,
        "totals": {g: genre_counts[g] for g in top_genres},
    }


# ---------------------------------------------------------------------------
# Chord diagram data (lineage cross-affinity matrix)
# ---------------------------------------------------------------------------

def build_chord_data(df, tree, threshold=0.08, max_lineages=12):
    """Build a chord diagram matrix from tree lineages using scored_search.

    For each lineage, scores all tracks against its filters. Then for each
    pair (i, j), counts tracks that score >= threshold for BOTH lineages.

    Returns {lineages: [...], matrix: [[int]], threshold, tree_type}.
    """
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    lineages = tree.get("lineages", [])
    if not lineages:
        return {"lineages": [], "matrix": [], "threshold": threshold,
                "tree_type": tree.get("tree_type", "genre")}

    # Sort by track_count descending, take top N
    sorted_lineages = sorted(lineages, key=lambda l: l.get("track_count", 0),
                             reverse=True)[:max_lineages]

    # Score all tracks against each lineage
    n_tracks = len(df)
    lineage_track_sets = []
    for lin in sorted_lineages:
        results = scored_search(df, lin.get("filters", {}),
                                min_score=threshold, max_results=n_tracks)
        lineage_track_sets.append({idx for idx, _score, _matched in results})

    # Build NxN matrix
    n = len(sorted_lineages)
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        matrix[i][i] = len(lineage_track_sets[i])
        for j in range(i + 1, n):
            shared = len(lineage_track_sets[i] & lineage_track_sets[j])
            matrix[i][j] = shared
            matrix[j][i] = shared

    return {
        "lineages": [
            {"id": l["id"], "title": l["title"],
             "track_count": l.get("track_count", 0),
             "filters": l.get("filters", {})}
            for l in sorted_lineages
        ],
        "matrix": matrix,
        "threshold": threshold,
        "tree_type": tree.get("tree_type", "genre"),
    }


# ---------------------------------------------------------------------------
# Genre landscape summary (for LLM context)
# ---------------------------------------------------------------------------

def build_genre_landscape_summary(df):
    """Build a human-readable summary of the genre landscape for LLM context."""
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    total = len(df)

    # Top genres
    all_genres = pd.concat([df["_genre1"], df["_genre2"]])
    all_genres = all_genres[all_genres != ""]
    genre_counts = Counter(all_genres)
    top_genres = genre_counts.most_common(40)

    # Top genre pairs
    pair_counts = Counter()
    for _, row in df.iterrows():
        g1, g2 = row["_genre1"], row["_genre2"]
        if g1 and g2:
            pair = tuple(sorted([g1, g2]))
            pair_counts[pair] += 1
    top_pairs = pair_counts.most_common(50)

    # Location distribution
    locations = df["_location"][df["_location"] != ""]
    loc_counts = Counter(locations).most_common(20)

    # Era distribution
    eras = df["_era"][df["_era"] != ""]
    era_counts = Counter(eras).most_common(20)

    # Mood keyword distribution
    mood_terms = Counter()
    for mood_val in df["_mood"][df["_mood"] != ""]:
        tokens = re.split(r"[,/&]+|\band\b", str(mood_val))
        for token in tokens:
            t = token.strip().lower()
            if t and len(t) > 2:
                mood_terms[t] += 1
    top_moods = mood_terms.most_common(30)

    # Descriptor keyword distribution
    desc_terms = Counter()
    for desc_val in df["_descriptors"][df["_descriptors"] != ""]:
        tokens = re.split(r"[,/&]+|\band\b", str(desc_val))
        for token in tokens:
            t = token.strip().lower()
            if t and len(t) > 2:
                desc_terms[t] += 1
    top_descriptors = desc_terms.most_common(30)

    lines = [
        f"Collection: {total} tracks.",
        "",
        "Top genres (appearing in either genre1 or genre2 position):",
    ]
    for g, c in top_genres:
        lines.append(f"  {g}: {c}")

    lines.append("")
    lines.append("Most common genre pairings (genre1 + genre2):")
    for (g1, g2), c in top_pairs:
        lines.append(f"  {g1} + {g2}: {c}")

    lines.append("")
    lines.append("Top locations:")
    for loc, c in loc_counts:
        lines.append(f"  {loc}: {c}")

    lines.append("")
    lines.append("Top eras:")
    for era, c in era_counts:
        lines.append(f"  {era}: {c}")

    lines.append("")
    lines.append("Top mood/atmosphere keywords (use these exact terms in mood filters):")
    for term, c in top_moods:
        lines.append(f"  {term}: {c}")

    lines.append("")
    lines.append("Top production descriptor keywords (use these exact terms in descriptor filters):")
    for term, c in top_descriptors:
        lines.append(f"  {term}: {c}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Facet options (for populating filter dropdowns)
# ---------------------------------------------------------------------------

def build_facet_options(df):
    """Build lists of distinct values per facet with counts, for UI dropdowns."""
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    def top_values(series, limit=80):
        s = series[series != ""]
        counts = Counter(s)
        return [{"value": v, "count": c} for v, c in counts.most_common(limit)]

    # Combine genre1 and genre2 into a single "genres" facet
    all_genres = pd.concat([df["_genre1"], df["_genre2"]])

    return {
        "genres": top_values(all_genres, 100),
        "locations": top_values(df["_location"], 50),
        "eras": top_values(df["_era"], 30),
    }


# ---------------------------------------------------------------------------
# Faceted search
# ---------------------------------------------------------------------------

def faceted_search(df, filters):
    """Search tracks using faceted filters. Returns list of row indices.

    Filter logic: AND across facets, OR within a facet.
    """
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    mask = pd.Series(True, index=df.index)

    # Genre filter (matches in either _genre1 or _genre2)
    genres = filters.get("genres")
    if genres:
        genres_lower = [g.lower() for g in genres]
        mask &= (
            df["_genre1"].str.lower().isin(genres_lower) |
            df["_genre2"].str.lower().isin(genres_lower)
        )

    # Mood keywords (OR — any keyword matches)
    mood_kw = filters.get("mood")
    if mood_kw:
        if isinstance(mood_kw, str):
            mood_kw = [k.strip() for k in mood_kw.split(",") if k.strip()]
        mood_mask = pd.Series(False, index=df.index)
        for kw in mood_kw:
            mood_mask |= df["_mood"].str.contains(kw, case=False, na=False)
        mask &= mood_mask

    # Descriptor keywords (AND — all keywords must match)
    desc_kw = filters.get("descriptors")
    if desc_kw:
        if isinstance(desc_kw, str):
            desc_kw = [k.strip() for k in desc_kw.split(",") if k.strip()]
        for kw in desc_kw:
            mask &= df["_descriptors"].str.contains(kw, case=False, na=False)

    # Location filter (OR)
    locations = filters.get("location")
    if locations:
        loc_mask = pd.Series(False, index=df.index)
        for loc in locations:
            loc_mask |= df["_location"].str.contains(loc, case=False, na=False)
        mask &= loc_mask

    # Era filter (OR)
    eras = filters.get("era")
    if eras:
        era_mask = pd.Series(False, index=df.index)
        for era in eras:
            era_mask |= df["_era"].str.contains(era, case=False, na=False)
        mask &= era_mask

    # BPM range
    bpm_min = filters.get("bpm_min")
    bpm_max = filters.get("bpm_max")
    if bpm_min is not None or bpm_max is not None:
        bpm = pd.to_numeric(df.get("bpm", pd.Series(dtype=float)), errors="coerce")
        if bpm_min is not None:
            mask &= bpm >= float(bpm_min)
        if bpm_max is not None:
            mask &= bpm <= float(bpm_max)

    # Year range
    year_min = filters.get("year_min")
    year_max = filters.get("year_max")
    if year_min is not None or year_max is not None:
        year = pd.to_numeric(df.get("year", pd.Series(dtype=float)), errors="coerce")
        if year_min is not None:
            mask &= year >= float(year_min)
        if year_max is not None:
            mask &= year <= float(year_max)

    # Free text search across all original fields
    text = filters.get("text_search")
    if text and text.strip():
        text = text.strip()
        text_mask = pd.Series(False, index=df.index)
        for col in ("title", "artist", "comment", "albumTitle"):
            if col in df.columns:
                text_mask |= df[col].astype(str).str.contains(text, case=False, na=False)
        mask &= text_mask

    return df.index[mask].tolist()


# ---------------------------------------------------------------------------
# Scored / ranked search
# ---------------------------------------------------------------------------

def scored_search(df, filters, min_score=0.0, max_results=200):
    """Score tracks against faceted filters with weighted relevance.

    Each facet match contributes points. Tracks are ranked by total score.
    Returns list of (row_index, score, matched_facets_dict) sorted by score desc.
    Score is normalized to 0-1.
    """
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    genres = filters.get("genres")
    mood_kw = filters.get("mood")
    desc_kw = filters.get("descriptors")
    locations = filters.get("location")
    eras = filters.get("era")
    bpm_min = filters.get("bpm_min")
    bpm_max = filters.get("bpm_max")
    year_min = filters.get("year_min")
    year_max = filters.get("year_max")

    # Normalize keyword lists
    if mood_kw and isinstance(mood_kw, str):
        mood_kw = [k.strip() for k in mood_kw.split(",") if k.strip()]
    if desc_kw and isinstance(desc_kw, str):
        desc_kw = [k.strip() for k in desc_kw.split(",") if k.strip()]

    # Calculate max possible score
    max_possible = 0.0
    if genres:
        max_possible += 3.0 * len(genres)
    if mood_kw:
        max_possible += 1.5 * len(mood_kw)
    if desc_kw:
        max_possible += 1.5 * len(desc_kw)
    if locations:
        max_possible += 2.0 * len(locations)
    if eras:
        max_possible += 1.5 * len(eras)
    if bpm_min is not None or bpm_max is not None:
        max_possible += 2.0
    if year_min is not None or year_max is not None:
        max_possible += 1.0

    if max_possible == 0:
        return []

    results = []

    for idx, row in df.iterrows():
        score = 0.0
        matched = {}

        # Genre scoring (3pts per match)
        if genres:
            g1 = str(row["_genre1"]).lower()
            g2 = str(row["_genre2"]).lower()
            genre_matches = []
            for g in genres:
                gl = g.lower()
                if gl == g1 or gl == g2:
                    score += 3.0
                    genre_matches.append(g)
            if genre_matches:
                matched["genres"] = genre_matches

        # Mood keyword scoring (1.5pts per match)
        if mood_kw:
            mood_val = str(row["_mood"]).lower()
            mood_matches = []
            for kw in mood_kw:
                if kw.lower() in mood_val:
                    score += 1.5
                    mood_matches.append(kw)
            if mood_matches:
                matched["mood"] = mood_matches

        # Descriptor keyword scoring (1.5pts per match)
        if desc_kw:
            desc_val = str(row["_descriptors"]).lower()
            desc_matches = []
            for kw in desc_kw:
                if kw.lower() in desc_val:
                    score += 1.5
                    desc_matches.append(kw)
            if desc_matches:
                matched["descriptors"] = desc_matches

        # Location scoring (2pts per match)
        if locations:
            loc_val = str(row["_location"]).lower()
            loc_matches = []
            for loc in locations:
                if loc.lower() in loc_val:
                    score += 2.0
                    loc_matches.append(loc)
            if loc_matches:
                matched["location"] = loc_matches

        # Era scoring (1.5pts per match)
        if eras:
            era_val = str(row["_era"]).lower()
            era_matches = []
            for era in eras:
                if era.lower() in era_val:
                    score += 1.5
                    era_matches.append(era)
            if era_matches:
                matched["era"] = era_matches

        # BPM range scoring (2pts)
        if bpm_min is not None or bpm_max is not None:
            try:
                bpm = float(row.get("bpm", 0) or 0)
                in_range = bpm > 0
                if in_range and bpm_min is not None and bpm < float(bpm_min):
                    in_range = False
                if in_range and bpm_max is not None and bpm > float(bpm_max):
                    in_range = False
                if in_range:
                    score += 2.0
                    matched["bpm"] = True
            except (ValueError, TypeError):
                pass

        # Year range scoring (1pt)
        if year_min is not None or year_max is not None:
            try:
                year = float(row.get("year", 0) or 0)
                in_range = year > 0
                if in_range and year_min is not None and year < float(year_min):
                    in_range = False
                if in_range and year_max is not None and year > float(year_max):
                    in_range = False
                if in_range:
                    score += 1.0
                    matched["year"] = True
            except (ValueError, TypeError):
                pass

        if score > 0:
            normalized = round(score / max_possible, 4)
            if normalized >= min_score:
                results.append((idx, normalized, matched))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:max_results]
