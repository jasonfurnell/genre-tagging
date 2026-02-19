/** Camelot key colors and compatibility for DJ mixing. */

const CAMELOT_COLORS: Record<string, string> = {
  '1A': '#7BEED9',
  '1B': '#86C8F0',
  '2A': '#A8E87E',
  '2B': '#7BEED9',
  '3A': '#D6E85A',
  '3B': '#A8E87E',
  '4A': '#F0D86E',
  '4B': '#D6E85A',
  '5A': '#F0A86E',
  '5B': '#F0D86E',
  '6A': '#F07E7E',
  '6B': '#F0A86E',
  '7A': '#E87EA8',
  '7B': '#F07E7E',
  '8A': '#D67EE8',
  '8B': '#E87EA8',
  '9A': '#A87EF0',
  '9B': '#D67EE8',
  '10A': '#7E8EF0',
  '10B': '#A87EF0',
  '11A': '#7EBEF0',
  '11B': '#7E8EF0',
  '12A': '#86C8F0',
  '12B': '#7EBEF0',
}

/**
 * Normalize a Camelot key string.
 * "10M" → "10B", "9m" → "9A", "10d" → "10B", etc.
 */
export function normalizeCamelot(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  const m = s.match(/^(\d{1,2})\s*([ABMDabmd])$/)
  if (!m) return null
  const num = m[1]
  const letter = m[2]
  // A/M = minor, B/D = major
  const mode = letter === 'A' || letter === 'M' ? 'A' : 'B'
  const n = parseInt(num)
  if (n < 1 || n > 12) return null
  return `${n}${mode}`
}

/** Get hex color for a Camelot key. Returns null if key invalid. */
export function camelotColor(key: string | null | undefined): string | null {
  const norm = normalizeCamelot(key)
  if (!norm) return null
  return CAMELOT_COLORS[norm] ?? null
}

/** Check if two Camelot keys are compatible (adjacent on the wheel). */
export function camelotCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeCamelot(a)
  const nb = normalizeCamelot(b)
  if (!na || !nb) return false
  if (na === nb) return true

  const numA = parseInt(na)
  const modeA = na.slice(-1)
  const numB = parseInt(nb)
  const modeB = nb.slice(-1)

  // Same mode, adjacent numbers (wrap 12→1)
  if (modeA === modeB) {
    const diff = Math.abs(numA - numB)
    return diff === 1 || diff === 11
  }
  // Different mode, same number
  return numA === numB
}
