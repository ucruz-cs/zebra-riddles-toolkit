import { parsePuzzle } from './schema.js'

const STORAGE_KEY = 'zebra.session.v1'

function toJSON(session) {
  return {
    kind: 'zebra-session',
    version: 1,
    model: 2,
    savedAt: new Date().toISOString(),
    puzzle: session.puzzle,
    grid: session.grid,
    clues: session.clues,
    ui: session.ui,
  }
}

/**
 * Sessions saved before the derived-propagation model baked propagated
 * eliminations into the stored grid. Re-expand any value that is forced into a
 * single position so unfilling a cell can bring candidates back, then let the
 * store re-derive propagation.
 */
function migrateOldGrid(grid, puzzle) {
  for (const category of puzzle.categories) {
    const row = grid[category.id]
    const positionsByValue = new Map()
    row.forEach((cell, position) => {
      for (const value of cell) {
        if (!positionsByValue.has(value)) positionsByValue.set(value, [])
        positionsByValue.get(value).push(position)
      }
    })

    for (const [value, positions] of positionsByValue) {
      if (positions.length !== 1) continue
      const holder = positions[0]
      row.forEach((cell, position) => {
        if (position === holder || cell.length <= 1) return
        if (!cell.includes(value)) cell.push(value)
      })
    }

    for (const cell of row) cell.sort((a, b) => a - b)
  }
}

/**
 * Rebuild a validated session from a saved object.
 */
function sessionFromJSON(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Session must be a JSON object.')
  if (!raw.puzzle) throw new Error('Session is missing "puzzle".')

  const puzzle = parsePuzzle(raw.puzzle)
  const grid = {}
  const positionCount = puzzle.positions.labels.length

  for (const category of puzzle.categories) {
    const row = raw.grid?.[category.id]
    if (!Array.isArray(row) || row.length !== positionCount) {
      throw new Error(`Grid data for "${category.label}" is missing or has the wrong number of positions.`)
    }
    grid[category.id] = row.map((cell) => {
      if (!Array.isArray(cell)) return category.values.map((_, index) => index)
      const cleaned = [...new Set(cell)]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < category.values.length)
        .sort((a, b) => a - b)
      return cleaned
    })
  }

  const clues = {}
  for (const clue of puzzle.clues) {
    const manual = raw.clues?.[clue.id]?.manual
    clues[clue.id] = { manual: manual === true ? true : null }
  }

  if (raw.model !== 2) migrateOldGrid(grid, puzzle)

  return {
    puzzle,
    grid,
    clues,
    ui: { showEliminated: Boolean(raw.ui?.showEliminated) },
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toJSON(session)))
  } catch (error) {
    console.warn('Could not save session', error)
  }
}

export function loadSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sessionFromJSON(JSON.parse(raw))
  } catch (error) {
    console.warn('Could not restore session', error)
    return null
  }
}
