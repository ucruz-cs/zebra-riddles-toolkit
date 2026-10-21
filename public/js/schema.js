export class PuzzleError extends Error {
  constructor(errors) {
    super(errors.join('\n'))
    this.name = 'PuzzleError'
    this.errors = errors
  }
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate and normalize a raw puzzle object.
 * Throws PuzzleError with a list of human readable problems.
 */
export function parsePuzzle(raw) {
  const errors = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PuzzleError(['The puzzle must be a JSON object.'])
  }

  const title = asTrimmedString(raw.title) || 'Untitled puzzle'

  const rawCategories = raw.categories
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
    throw new PuzzleError(['"categories" must be a non-empty array.'])
  }

  const categories = []
  const usedIds = new Set()

  rawCategories.forEach((rawCategory, index) => {
    const label = asTrimmedString(rawCategory?.label) || asTrimmedString(rawCategory?.name)
    if (!label) errors.push(`Category #${index + 1} is missing a "label".`)

    const rawValues = rawCategory?.values ?? rawCategory?.options
    if (!Array.isArray(rawValues) || rawValues.length < 2) {
      errors.push(`Category "${label || index + 1}" needs at least 2 "values".`)
    }

    const values = []
    const seenValues = new Set()
    for (const rawValue of Array.isArray(rawValues) ? rawValues : []) {
      const value = asTrimmedString(rawValue)
      if (!value) {
        errors.push(`Category "${label || index + 1}" contains an empty value.`)
        continue
      }
      const key = value.toLowerCase()
      if (seenValues.has(key)) {
        errors.push(`Category "${label || index + 1}" has the duplicate value "${value}".`)
        continue
      }
      seenValues.add(key)
      values.push(value)
    }

    let id = asTrimmedString(rawCategory?.id) || slugify(label) || `cat${index + 1}`
    if (usedIds.has(id)) {
      let suffix = 2
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    usedIds.add(id)

    categories.push({ id, label: label || `Category ${index + 1}`, values })
  })

  let positionLabels = null
  if (Array.isArray(raw.positions)) {
    positionLabels = raw.positions
  } else if (raw.positions && Array.isArray(raw.positions.labels)) {
    positionLabels = raw.positions.labels
  } else if (raw.positions && raw.positions.labels != null) {
    errors.push('"positions.labels" must be an array.')
  }

  const valueCounts = [...new Set(categories.map((category) => category.values.length).filter((n) => n > 0))]
  if (valueCounts.length > 1) {
    errors.push(
      `All categories must have the same number of values: ${categories
        .map((category) => `${category.label}: ${category.values.length}`)
        .join(', ')}.`,
    )
  }

  let positionCount = valueCounts.length === 1 ? valueCounts[0] : 0
  if (positionLabels) {
    const labels = positionLabels.map((label, index) => asTrimmedString(label) || `#${index + 1}`)
    if (labels.length < 2) errors.push('A puzzle needs at least 2 positions.')
    else if (positionCount && labels.length !== positionCount) {
      errors.push(
        `"positions.labels" has ${labels.length} entries but the categories have ${positionCount} values.`,
      )
    }
    positionLabels = labels
    if (!positionCount) positionCount = labels.length
  }

  if (positionCount >= 2) {
    if (!positionLabels) {
      positionLabels = Array.from({ length: positionCount }, (_, index) => `#${index + 1}`)
    }
  }

  const rawClues = raw.clues ?? []
  if (!Array.isArray(rawClues)) errors.push('"clues" must be an array.')

  const clues = []
  const clueIds = new Set()
  ;(Array.isArray(rawClues) ? rawClues : []).forEach((rawClue, index) => {
    const text = asTrimmedString(rawClue?.text)
    if (!text) errors.push(`Clue #${index + 1} is missing "text".`)

    const entities = Array.isArray(rawClue?.entities)
      ? rawClue.entities.map(asTrimmedString).filter(Boolean)
      : []

    let constraints = rawClue?.constraints ?? (rawClue?.constraint ? [rawClue.constraint] : [])
    if (!Array.isArray(constraints)) constraints = []
    constraints = constraints.filter((constraint) => constraint && typeof constraint === 'object')

    let id = asTrimmedString(rawClue?.id) || `c${index + 1}`
    if (clueIds.has(id)) {
      let suffix = 2
      while (clueIds.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    clueIds.add(id)

    clues.push({ id, text, entities, constraints })
  })

  if (errors.length) throw new PuzzleError(errors)

  const positionLabel =
    typeof raw.positions?.label === 'string' && raw.positions.label.trim()
      ? raw.positions.label.trim()
      : 'Position'

  return {
    version: 1,
    title,
    positions: { label: positionLabel, labels: positionLabels },
    categories,
    clues,
  }
}
