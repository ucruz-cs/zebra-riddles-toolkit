/**
 * Shared test fixtures.
 *
 * `makePuzzle` builds the normalized shape used by the app. Positions are
 * derived from the first category's value count, so callers don't have to keep
 * those two counts in sync by hand.
 */
export function makePuzzle({ categories, clues = [] } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('makePuzzle needs at least one category')
  }

  const positions = categories[0].values.length

  return {
    version: 1,
    title: 'Test puzzle',
    positions: {
      label: 'Position',
      labels: Array.from({ length: positions }, (_, index) => `#${index + 1}`),
    },
    categories: categories.map((category) => ({
      id: category.id,
      label: category.label ?? category.id,
      values: [...category.values],
    })),
    clues: clues.map((clue, index) => ({
      id: clue.id ?? `c${index + 1}`,
      text: clue.text ?? `Clue ${index + 1}`,
      entities: clue.entities ?? [],
      constraints: clue.constraints ?? [],
    })),
  }
}

export function emptyGrid(puzzle) {
  const grid = {}
  for (const category of puzzle.categories) {
    grid[category.id] = puzzle.positions.labels.map(() =>
      category.values.map((_, index) => index),
    )
  }
  return grid
}

/**
 * Place a value at exactly one zero-based position and remove it from the
 * other cells in its row.
 */
export function placeValue(grid, categoryId, valueIndex, position) {
  grid[categoryId] = grid[categoryId].map((cell, index) => {
    if (index === position) return [valueIndex]
    return cell.filter((value) => value !== valueIndex)
  })
}

/**
 * Restrict a value to a set of zero-based positions while leaving the other
 * candidates in the row untouched. Useful for pending/ambiguous domains.
 */
export function restrictValue(grid, categoryId, valueIndex, positions) {
  grid[categoryId] = grid[categoryId].map((cell, index) => {
    const next = cell.filter((value) => value !== valueIndex)
    if (positions.includes(index)) next.push(valueIndex)
    return next.sort((a, b) => a - b)
  })
}
