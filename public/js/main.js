import { parsePuzzle } from './schema.js'
import { createSession, Store } from './state.js'
import { loadSavedSession, saveSession } from './storage.js'
import { UI } from './ui.js'

const FALLBACK_PUZZLE = {
  title: 'Blank puzzle',
  positions: { label: 'Position', labels: ['#1', '#2', '#3'] },
  categories: [
    { id: 'first', label: 'Category A', values: ['A1', 'A2', 'A3'] },
    { id: 'second', label: 'Category B', values: ['B1', 'B2', 'B3'] },
  ],
  clues: [],
}

async function loadSample() {
  const response = await fetch('/samples/neighbors.json')
  if (!response.ok) throw new Error(`Could not fetch the sample (HTTP ${response.status}).`)
  return createSession(parsePuzzle(await response.json()))
}

async function boot() {
  let session = loadSavedSession()

  if (!session) {
    try {
      session = await loadSample()
    } catch (error) {
      console.error(error)
      session = createSession(parsePuzzle(FALLBACK_PUZZLE))
    }
  }

  const store = new Store(session)
  const ui = new UI(store)
  ui.mount()

  store.subscribe((current) => saveSession(current))
  saveSession(store.session)
}

boot()
