import { slugify } from './schema.js'

/**
 * Clue predicates.
 *
 * Every predicate is evaluated against the *current candidate domains* of the
 * referenced values. A clue is:
 *   satisfied - every remaining possible placement satisfies it
 *   violated  - no remaining possible placement satisfies it
 *   pending   - some placements satisfy it, some do not
 *   unknown   - it cannot be evaluated (bad reference, unknown type, empty domain)
 */
const PREDICATES = {
  at: {
    roles: ['subject'],
    test: (positions, constraint, ctx) => positionSet(constraint.positions, ctx.positionCount).has(positions.subject),
  },
  same: {
    roles: ['a', 'b'],
    test: (positions) => positions.a === positions.b,
  },
  nextTo: {
    roles: ['a', 'b'],
    test: (positions) => Math.abs(positions.a - positions.b) === 1,
  },
  immediatelyBefore: {
    roles: ['a', 'b'],
    test: (positions) => positions.b === positions.a + 1,
  },
  immediatelyAfter: {
    roles: ['a', 'b'],
    test: (positions) => positions.a === positions.b + 1,
  },
  leftOf: {
    roles: ['a', 'b'],
    test: (positions) => positions.a < positions.b,
  },
  rightOf: {
    roles: ['a', 'b'],
    test: (positions) => positions.a > positions.b,
  },
  between: {
    roles: ['subject', 'after', 'before'],
    test: (positions) => positions.after < positions.subject && positions.subject < positions.before,
  },
}

const TYPE_ALIASES = {
  at: 'at',
  position: 'at',
  positions: 'at',
  seat: 'at',
  isat: 'at',
  isinposition: 'at',
  same: 'same',
  equal: 'same',
  equals: 'same',
  sameas: 'same',
  issame: 'same',
  nextto: 'nextTo',
  next: 'nextTo',
  beside: 'nextTo',
  adjacent: 'nextTo',
  rightnextto: 'nextTo',
  immediatelybefore: 'immediatelyBefore',
  directlybefore: 'immediatelyBefore',
  justbefore: 'immediatelyBefore',
  immediatelyafter: 'immediatelyAfter',
  directlyafter: 'immediatelyAfter',
  justafter: 'immediatelyAfter',
  leftof: 'leftOf',
  somewhereleftof: 'leftOf',
  totheleftof: 'leftOf',
  rightof: 'rightOf',
  somewhererightof: 'rightOf',
  totherightof: 'rightOf',
  somewheretotherightof: 'rightOf',
  between: 'between',
  somewherebetween: 'between',
  inbetween: 'between',
}

export const PREDICATE_TYPES = Object.keys(PREDICATES)

export function canonicalType(type) {
  const key = String(type ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return TYPE_ALIASES[key] || null
}

export function findCategory(puzzle, key) {
  const raw = String(key ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  return (
    puzzle.categories.find((category) => category.id.toLowerCase() === lower) ||
    puzzle.categories.find((category) => category.label.toLowerCase() === lower) ||
    puzzle.categories.find((category) => slugify(category.id) === slugify(lower)) ||
    puzzle.categories.find((category) => slugify(category.label) === slugify(lower)) ||
    null
  )
}

function numericValue(value) {
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!/\d/.test(cleaned)) return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}

/**
 * Resolve "category:value" against the puzzle and the current grid.
 * Also understands "age:max" / "age:min" for superlatives.
 */
export function resolveRef(puzzle, grid, ref) {
  const text = String(ref ?? '')
  const separator = text.indexOf(':')
  if (separator < 0) return { error: `Reference "${text}" must look like "category:value".` }

  const categoryKey = text.slice(0, separator).trim()
  const valueKey = text.slice(separator + 1).trim()
  const category = findCategory(puzzle, categoryKey)
  if (!category) return { error: `Unknown category "${categoryKey}".` }
  if (!valueKey) return { error: `Reference "${text}" is missing a value.` }

  let index = category.values.findIndex((value) => value.toLowerCase() === valueKey.toLowerCase())
  if (index < 0) {
    const lower = valueKey.toLowerCase()
    if (lower === 'max' || lower === 'min') {
      const numeric = category.values
        .map((value, valueIndex) => ({ value, valueIndex, number: numericValue(value) }))
        .filter((entry) => entry.number !== null)
        .sort((a, b) => a.number - b.number)
      if (numeric.length) {
        const pick = lower === 'max' ? numeric[numeric.length - 1] : numeric[0]
        index = pick.valueIndex
      }
    }
  }

  if (index < 0) return { error: `Unknown value "${valueKey}" in category "${category.label}".` }

  const positions = []
  const row = grid[category.id] || []
  row.forEach((cell, positionIndex) => {
    if (cell.includes(index)) positions.push(positionIndex + 1)
  })

  return {
    category,
    index,
    value: category.values[index],
    positions,
  }
}

export function positionSet(spec, positionCount) {
  if (Array.isArray(spec)) {
    return new Set(
      spec
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= positionCount),
    )
  }
  if (typeof spec === 'number') {
    return Number.isInteger(spec) && spec >= 1 && spec <= positionCount ? new Set([spec]) : new Set()
  }
  if (spec == null || spec === '') return new Set()

  const text = String(spec).trim().toLowerCase()
  if (text === 'ends' || text === 'end' || text === 'either end') {
    return positionCount > 1 ? new Set([1, positionCount]) : new Set([1])
  }
  if (text === 'first' || text === 'firstposition' || text === 'thefirst') return new Set([1])
  if (text === 'last' || text === 'lastposition' || text === 'thelast') return new Set([positionCount])
  if (text === 'middle') {
    if (positionCount % 2 === 1) return new Set([(positionCount + 1) / 2])
    return new Set([positionCount / 2, positionCount / 2 + 1])
  }
  const number = Number(text)
  if (Number.isInteger(number) && number >= 1 && number <= positionCount) return new Set([number])
  return new Set()
}

function cartesian(domains) {
  const results = []
  const walk = (index, current) => {
    if (index === domains.length) {
      results.push([...current])
      return
    }
    for (const position of domains[index]) {
      current.push(position)
      walk(index + 1, current)
      current.pop()
    }
  }
  walk(0, [])
  return results
}

function sameCategoryCollision(resolved, assignment) {
  const seen = new Map()
  for (let index = 0; index < resolved.length; index += 1) {
    const entry = resolved[index]
    const position = assignment[index]
    const categoryId = entry.category.id
    if (seen.has(categoryId) && seen.get(categoryId) === position) return true
    seen.set(categoryId, position)
  }
  return false
}

export function evaluateConstraint(constraint, puzzle, grid) {
  const type = canonicalType(constraint?.type)
  if (!type) {
    return { status: 'unknown', reason: `Unknown clue type ${JSON.stringify(constraint?.type ?? null)}.` }
  }

  const definition = PREDICATES[type]
  const resolved = []
  for (const role of definition.roles) {
    const result = resolveRef(puzzle, grid, constraint[role])
    if (result.error) return { status: 'unknown', reason: result.error, type }
    resolved.push(result)
  }

  if (resolved.some((entry) => entry.positions.length === 0)) {
    return {
      status: 'unknown',
      type,
      reason: 'A value named by this clue has no possible position left.',
    }
  }

  const positionCount = puzzle.positions.labels.length
  if (type === 'at' && positionSet(constraint.positions, positionCount).size === 0) {
    return { status: 'unknown', type, reason: `Invalid position specifier ${JSON.stringify(constraint.positions)}.` }
  }

  const assignments = cartesian(resolved.map((entry) => entry.positions))
  let total = 0
  let matching = 0

  for (const assignment of assignments) {
    if (sameCategoryCollision(resolved, assignment)) continue
    total += 1
    const named = {}
    definition.roles.forEach((role, index) => {
      named[role] = assignment[index]
    })
    if (definition.test(named, constraint, { positionCount })) matching += 1
  }

  if (total === 0) {
    return { status: 'unknown', type, reason: 'This clue cannot be evaluated with the current grid.' }
  }
  if (matching === total) return { status: 'satisfied', type, total, matching }
  if (matching === 0) return { status: 'violated', type, total, matching }
  return { status: 'pending', type, total, matching }
}

/**
 * Some clue texts spell a value differently than the option list. Ages are the
 * common case: the option "38 years" appears in clues as "38-year-old".
 */
function valueVariants(value) {
  const trimmed = String(value).trim()
  const numeric = /^(\d+)(?:\s*years?)?$/i.exec(trimmed)
  if (!numeric) return [trimmed]
  const number = numeric[1]
  return [trimmed, `${number}-year-old`, `${number} year old`, `${number} years old`, `${number}-years-old`]
}

/**
 * Find value names inside a clue's text so they can be highlighted/linked.
 * Longest match wins on overlaps.
 */
export function findValueLinks(text, puzzle) {
  const found = []
  for (const category of puzzle.categories) {
    for (let index = 0; index < category.values.length; index += 1) {
      const value = category.values[index]
      for (const variant of valueVariants(value)) {
        if (variant.length < 3) continue
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
        let match
        while ((match = pattern.exec(text)) !== null) {
          found.push({
            start: match.index,
            end: match.index + match[0].length,
            categoryId: category.id,
            index,
            value: category.values[index],
          })
          if (match[0].length === 0) pattern.lastIndex += 1
        }
      }
    }
  }

  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const links = []
  let cursor = -1
  for (const link of found) {
    if (link.start < cursor) continue
    links.push(link)
    cursor = link.end
  }
  return links
}

/**
 * Fallback for clues without machine-readable constraints: done once every
 * value the clue names has exactly one possible position.
 */
function evaluateFallback(clue, puzzle, grid) {
  const refs = new Set(clue.entities)
  for (const link of findValueLinks(clue.text, puzzle)) refs.add(`${link.categoryId}:${link.value}`)

  if (!refs.size) {
    return {
      status: 'unknown',
      checks: [],
      issues: ['No constraint and no known values found in the text.'],
    }
  }

  const issues = []
  const resolved = []
  for (const ref of refs) {
    const result = resolveRef(puzzle, grid, ref)
    if (result.error) issues.push(result.error)
    else resolved.push(result)
  }

  if (issues.length) return { status: 'unknown', checks: [], issues }
  if (resolved.some((entry) => entry.positions.length === 0)) {
    return { status: 'unknown', checks: [], issues: ['A value named by this clue has no possible position.'] }
  }
  if (resolved.every((entry) => entry.positions.length === 1)) {
    return { status: 'satisfied', checks: [], issues: [] }
  }
  return { status: 'pending', checks: [], issues: [] }
}

export function evaluateClue(clue, puzzle, grid) {
  const constraints = Array.isArray(clue.constraints) ? clue.constraints : []
  if (!constraints.length) return evaluateFallback(clue, puzzle, grid)

  const checks = constraints.map((constraint) => ({
    constraint,
    ...evaluateConstraint(constraint, puzzle, grid),
  }))
  const issues = checks.filter((check) => check.status === 'unknown').map((check) => check.reason)

  let status
  if (checks.some((check) => check.status === 'violated')) status = 'violated'
  else if (checks.some((check) => check.status === 'unknown')) status = 'unknown'
  else if (checks.some((check) => check.status === 'pending')) status = 'pending'
  else status = 'satisfied'

  return { status, checks, issues }
}

const VERBS = {
  at: 'is at',
  same: 'is the same as',
  nextTo: 'is next to',
  immediatelyBefore: 'is immediately before',
  immediatelyAfter: 'is immediately after',
  leftOf: 'is somewhere to the left of',
  rightOf: 'is somewhere to the right of',
  between: 'is somewhere between',
}

function displayRef(ref, puzzle) {
  const text = String(ref ?? '')
  const separator = text.indexOf(':')
  if (separator < 0) return text || '?'
  const category = findCategory(puzzle, text.slice(0, separator))
  if (!category) return text
  let value = text.slice(separator + 1).trim()
  if (/^(max|min)$/i.test(value)) {
    const numeric = category.values
      .map((entry) => ({ value: entry, number: numericValue(entry) }))
      .filter((entry) => entry.number !== null)
      .sort((a, b) => a.number - b.number)
    if (numeric.length) {
      value = value.toLowerCase() === 'max' ? numeric[numeric.length - 1].value : numeric[0].value
    }
  }
  return `${value} (${category.label})`
}

export function describeConstraint(constraint, puzzle) {
  const type = canonicalType(constraint?.type)
  if (!type) return `Unknown clue type: ${JSON.stringify(constraint?.type ?? null)}`
  const verb = VERBS[type] || type

  if (type === 'at') {
    const spec = constraint.positions
    const words = {
      ends: 'one of the ends',
      end: 'one of the ends',
      first: 'the first position',
      last: 'the last position',
      middle: 'a middle position',
    }
    let where
    if (Array.isArray(spec)) where = `position ${spec.join(' or ')}`
    else if (words[String(spec).trim().toLowerCase()]) where = words[String(spec).trim().toLowerCase()]
    else if (/^\d+$/.test(String(spec))) where = `position ${spec}`
    else where = String(spec)
    return `${displayRef(constraint.subject, puzzle)} ${verb} ${where}`
  }
  if (type === 'between') {
    return `${displayRef(constraint.subject, puzzle)} ${verb} ${displayRef(constraint.after, puzzle)} and ${displayRef(
      constraint.before,
      puzzle,
    )}, in that order`
  }
  return `${displayRef(constraint.a, puzzle)} ${verb} ${displayRef(constraint.b, puzzle)}`
}
