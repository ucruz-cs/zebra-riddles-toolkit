export function createSession(puzzle) {
  const grid = {}
  for (const category of puzzle.categories) {
    grid[category.id] = puzzle.positions.labels.map(() => category.values.map((_, index) => index))
  }

  const clues = {}
  for (const clue of puzzle.clues) clues[clue.id] = { manual: null }

  return {
    puzzle,
    grid,
    clues,
    ui: { showEliminated: false },
  }
}

function cloneGrid(grid) {
  const copy = {}
  for (const [categoryId, cells] of Object.entries(grid)) {
    copy[categoryId] = cells.map((cell) => [...cell])
  }
  return copy
}

/**
 * Requirement: a cell with a single remaining value removes that value from
 * every other cell in its row. Runs to a fixpoint so cascades settle.
 *
 * This operates on a derived copy of the grid. The stored grid only holds
 * manual candidate edits, so unfilling a cell brings back the candidates that
 * the fill had removed.
 */
export function propagateGrid(grid) {
  let changed = false
  let again = true

  while (again) {
    again = false
    for (const rows of Object.values(grid)) {
      for (let index = 0; index < rows.length; index += 1) {
        const cell = rows[index]
        if (cell.length !== 1) continue
        const value = cell[0]
        for (let other = 0; other < rows.length; other += 1) {
          if (other === index) continue
          const target = rows[other]
          if (!target.includes(value)) continue
          rows[other] = target.filter((entry) => entry !== value)
          changed = true
          again = true
        }
      }
    }
  }

  return changed
}

export class Store {
  #listeners = new Set()

  constructor(session) {
    this.session = session
    this.history = []
    this.future = []
    this.effective = this.computeEffective()
  }

  computeEffective() {
    const grid = cloneGrid(this.session.grid)
    propagateGrid(grid)
    return grid
  }

  subscribe(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  notify() {
    for (const listener of this.#listeners) listener(this.session)
  }

  snapshot() {
    return JSON.stringify({ grid: this.session.grid, clues: this.session.clues })
  }

  restore(snapshot) {
    const data = JSON.parse(snapshot)
    this.session.grid = data.grid
    this.session.clues = data.clues
    this.effective = this.computeEffective()
  }

  commit(mutator, { history = true } = {}) {
    const before = this.snapshot()
    mutator(this.session)
    this.effective = this.computeEffective()
    const changed = before !== this.snapshot()

    if (changed && history) {
      this.history.push(before)
      if (this.history.length > 200) this.history.shift()
      this.future.length = 0
    }

    this.notify()
    return changed
  }

  loadSession(session) {
    this.session = session
    this.effective = this.computeEffective()
    this.history = []
    this.future = []
    this.notify()
  }

  canUndo() {
    return this.history.length > 0
  }

  canRedo() {
    return this.future.length > 0
  }

  undo() {
    const previous = this.history.pop()
    if (!previous) return false
    this.future.push(this.snapshot())
    this.restore(previous)
    this.notify()
    return true
  }

  redo() {
    const next = this.future.pop()
    if (!next) return false
    this.history.push(this.snapshot())
    this.restore(next)
    this.notify()
    return true
  }

  setUI(key, value) {
    this.session.ui[key] = value
    this.notify()
  }

  toggleCandidate(categoryId, position, valueIndex) {
    const wasPossible = this.effective[categoryId][position].includes(valueIndex)
    const restoring = !wasPossible

    this.commit((session) => {
      const cell = session.grid[categoryId][position]
      if (restoring) {
        if (!cell.includes(valueIndex)) {
          session.grid[categoryId][position] = [...cell, valueIndex].sort((a, b) => a - b)
        }
      } else {
        session.grid[categoryId][position] = cell.filter((entry) => entry !== valueIndex)
      }
    })

    const nowPossible = this.effective[categoryId][position].includes(valueIndex)
    return { restored: restoring, blocked: restoring && !nowPossible }
  }

  keepOnly(categoryId, position, valueIndex) {
    const rows = this.effective[categoryId]
    const clash = rows.findIndex(
      (cell, index) => index !== position && cell.length === 1 && cell[0] === valueIndex,
    )
    if (clash !== -1) return { blocked: true, position: clash }

    this.commit((session) => {
      session.grid[categoryId][position] = [valueIndex]
    })

    const cell = this.effective[categoryId][position]
    if (cell.length === 1 && cell[0] === valueIndex) return { blocked: false }

    const holder = this.effective[categoryId].findIndex(
      (other, index) => index !== position && other.length === 1 && other[0] === valueIndex,
    )
    return { blocked: true, position: holder }
  }

  setClueManual(clueId, value) {
    this.commit((session) => {
      session.clues[clueId] = { manual: value }
    })
  }

  setClueConstraints(clueId, constraints) {
    this.commit((session) => {
      const clue = session.puzzle.clues.find((entry) => entry.id === clueId)
      if (clue) clue.constraints = constraints
    })
  }

  clearClueManual(clueId) {
    const entry = this.session.clues[clueId]
    if (entry) entry.manual = null
  }

  resetGrid() {
    this.commit((session) => {
      for (const category of session.puzzle.categories) {
        session.grid[category.id] = session.puzzle.positions.labels.map(() =>
          category.values.map((_, index) => index),
        )
      }
      for (const clue of session.puzzle.clues) session.clues[clue.id] = { manual: null }
    })
  }
}
