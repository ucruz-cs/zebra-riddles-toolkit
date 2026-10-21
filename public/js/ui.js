import { describeConstraint, evaluateClue, findValueLinks } from './clues.js'
import { parsePuzzle, PuzzleError } from './schema.js'
import { createSession } from './state.js'
import { LLM_PROMPT } from './prompt.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ESCAPES[character])

const STATUS_LABEL = {
  satisfied: 'auto-done',
  violated: 'conflicts with grid',
  pending: 'open',
  unknown: 'needs a constraint',
}

function truncate(text, length = 110) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function positionTitle(puzzle, index) {
  const label = puzzle.positions.labels[index] ?? `#${index + 1}`
  if (!label.startsWith('#')) return label
  return `${puzzle.positions.label} ${label}`
}

export class UI {
  constructor(store) {
    this.store = store
    this.openClue = null
    this.popover = null
    this.anchor = null
    this.hoverRef = null
    this.pinnedRef = null
    this.toastTimer = null
    store.subscribe(() => this.render())
  }

  mount() {
    const byId = (id) => document.getElementById(id)
    this.dom = {
      title: byId('puzzle-title'),
      progress: byId('progress'),
      undo: byId('btn-undo'),
      redo: byId('btn-redo'),
      toggleEliminated: byId('toggle-eliminated'),
      load: byId('btn-load'),
      edit: byId('btn-edit'),
      reset: byId('btn-reset'),
      contradictions: byId('contradictions'),
      grid: byId('grid'),
      clueCount: byId('clue-count'),
      clueList: byId('clue-list'),
      popover: byId('popover'),
      toast: byId('toast'),
      loadDialog: byId('load-dialog'),
      loadJson: byId('load-json'),
      loadErrors: byId('load-errors'),
      loadStatus: byId('load-status'),
      loadFile: byId('load-file'),
      sampleButton: byId('btn-sample'),
      sampleMenu: byId('sample-menu'),
      promptDialog: byId('prompt-dialog'),
      promptText: byId('prompt-text'),
      solvedOverlay: byId('solved-overlay'),
      solvedSubtitle: byId('solved-subtitle'),
      solvedClose: byId('btn-solved-close'),
      solvedReset: byId('btn-solved-reset'),
      confetti: byId('confetti'),
    }

    this.bind()
    this.render()
  }

  /* ------------------------------ events ------------------------------ */

  bind() {
    const dom = this.dom

    dom.undo.addEventListener('click', () => this.store.undo())
    dom.redo.addEventListener('click', () => this.store.redo())
    dom.toggleEliminated.addEventListener('change', () =>
      this.store.setUI('showEliminated', dom.toggleEliminated.checked),
    )

    dom.load.addEventListener('click', () => this.openLoadDialog(''))
    dom.edit.addEventListener('click', () =>
      this.openLoadDialog(JSON.stringify(this.store.session.puzzle, null, 2)),
    )
    dom.reset.addEventListener('click', () => {
      if (!this.hasProgress()) {
        this.store.resetGrid()
        this.toast('Grid cleared.')
        return
      }
      if (confirm('Clear the whole grid and all clue marks?')) {
        this.store.resetGrid()
        this.toast('Grid cleared.')
      }
    })

    this.bindGrid()
    this.bindClues()
    this.bindPopover()
    this.bindDialogs()

    dom.solvedClose.addEventListener('click', () => this.closeSolved())
    dom.solvedReset.addEventListener('click', () => {
      this.closeSolved()
      this.store.resetGrid()
      this.toast('Grid cleared.')
    })
    dom.solvedOverlay.addEventListener('click', (event) => {
      if (event.target === dom.solvedOverlay) this.closeSolved()
    })

    document.addEventListener('keydown', (event) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === 'Escape') {
        if (!this.dom.solvedOverlay.hidden) {
          this.closeSolved()
          return
        }
        if (this.popover) this.closePopover()
        this.pinnedRef = null
        this.hoverRef = null
        this.applyHighlight()
        return
      }

      if (typing || !(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        this.store.undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        this.store.redo()
      }
    })

    window.addEventListener('resize', () => {
      if (this.popover) this.renderPopover()
    })
  }

  bindGrid() {
    const grid = this.dom.grid

    grid.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip')
      if (chip) {
        const { cat, pos, val } = chip.dataset
        const result = this.store.toggleCandidate(cat, Number(pos), Number(val))
        if (result.blocked) this.showPlacedElsewhere(cat, Number(val))
        return
      }

      const cell = event.target.closest('td.cell')
      if (cell) this.openCellPopover(cell)
    })

    grid.addEventListener('mouseover', (event) => {
      const cell = event.target.closest('td.cell')
      this.highlightColumn(cell ? Number(cell.dataset.pos) : null)

      const chip = event.target.closest('.chip')
      if (chip) this.setHoverRef({ categoryId: chip.dataset.cat, index: Number(chip.dataset.val) })
    })

    grid.addEventListener('mouseleave', () => {
      this.highlightColumn(null)
      this.setHoverRef(null)
    })
  }

  bindClues() {
    const list = this.dom.clueList

    list.addEventListener('change', (event) => {
      const box = event.target.closest('input[type="checkbox"]')
      if (!box) return
      const clue = box.closest('.clue')
      this.store.setClueManual(clue.dataset.clue, box.checked ? true : null)
    })

    list.addEventListener('click', (event) => {
      const entity = event.target.closest('.ent')
      if (entity) {
        const ref = { categoryId: entity.dataset.cat, index: Number(entity.dataset.idx) }
        const isSame = this.pinnedRef && this.pinnedRef.categoryId === ref.categoryId && this.pinnedRef.index === ref.index
        this.pinnedRef = isSame ? null : ref
        this.applyHighlight()
        return
      }

      const actionButton = event.target.closest('[data-act]')
      if (!actionButton) return
      const action = actionButton.dataset.act
      const clueElement = actionButton.closest('.clue')

      if (action === 'inspect') {
        const id = clueElement.dataset.clue
        this.openClue = this.openClue === id ? null : id
        this.renderClues()
        return
      }

      if (action === 'apply-clue') {
        const id = clueElement.dataset.clue
        const textarea = clueElement.querySelector('.inspector-json')
        const message = clueElement.querySelector('.inspector-msg')
        try {
          const parsed = JSON.parse(textarea.value)
          if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object')) {
            throw new Error('Constraints must be an array of objects.')
          }
          this.store.setClueConstraints(id, parsed)
          this.toast('Constraints updated.')
        } catch (error) {
          if (message) message.textContent = error.message
        }
        return
      }

      if (action === 'reset-clue') {
        const id = clueElement.dataset.clue
        const clue = this.store.session.puzzle.clues.find((entry) => entry.id === id)
        const textarea = clueElement.querySelector('.inspector-json')
        if (clue && textarea) textarea.value = JSON.stringify(clue.constraints, null, 2)
        return
      }
    })

    list.addEventListener('mouseover', (event) => {
      const entity = event.target.closest('.ent')
      if (entity) this.setHoverRef({ categoryId: entity.dataset.cat, index: Number(entity.dataset.idx) })
    })

    list.addEventListener('mouseleave', () => {
      if (!this.pinnedRef) this.setHoverRef(null)
    })
  }

  bindPopover() {
    const popover = this.dom.popover

    popover.addEventListener('change', (event) => {
      const box = event.target.closest('input[data-val]')
      if (!box || !this.popover) return
      this.store.toggleCandidate(this.popover.categoryId, this.popover.position, Number(box.dataset.val))
    })

    popover.addEventListener('click', (event) => {
      const only = event.target.closest('.only')
      if (only && this.popover) {
        const valueIndex = Number(only.dataset.val)
        const result = this.store.keepOnly(this.popover.categoryId, this.popover.position, valueIndex)
        if (result.blocked) {
          this.showPlacedElsewhere(this.popover.categoryId, valueIndex)
          return
        }
        this.closePopover()
        return
      }
      if (event.target.closest('[data-act="pop-close"]')) this.closePopover()
    })

    document.addEventListener('mousedown', (event) => {
      if (!this.popover) return
      if (event.target.closest('#popover') || event.target.closest('td.cell')) return
      this.closePopover()
    })

    window.addEventListener('scroll', () => {
      if (this.popover) this.closePopover()
    })

    document.querySelector('.table-scroll')?.addEventListener(
      'scroll',
      () => {
        if (this.popover) this.closePopover()
      },
      { passive: true },
    )
  }

  bindDialogs() {
    const dom = this.dom

    document.getElementById('btn-cancel-load').addEventListener('click', () => dom.loadDialog.close())
    document.getElementById('btn-apply-load').addEventListener('click', () => this.applyLoadText(dom.loadJson.value))
    document.getElementById('btn-pick-file').addEventListener('click', () => dom.loadFile.click())
    dom.sampleButton.addEventListener('click', () => this.toggleSampleMenu())
    dom.sampleMenu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-file]')
      if (item) this.previewSample(item.dataset.file)
    })

    document.addEventListener('mousedown', (event) => {
      if (dom.sampleMenu.hidden) return
      if (event.target.closest('.menu-wrap')) return
      this.closeSampleMenu()
    })

    dom.loadDialog.addEventListener('close', () => this.closeSampleMenu())
    dom.loadJson.addEventListener('input', () => this.setLoadStatus(''))

    dom.loadFile.addEventListener('change', async () => {
      const file = dom.loadFile.files?.[0]
      if (!file) return
      dom.loadJson.value = await file.text()
      dom.loadFile.value = ''
      this.showLoadErrors([])
      this.setLoadStatus(`${file.name} loaded into the editor — press Load to start.`)
    })

    document.getElementById('btn-prompt').addEventListener('click', () => {
      dom.promptText.value = LLM_PROMPT
      dom.promptDialog.showModal()
    })
    document.getElementById('btn-close-prompt').addEventListener('click', () => dom.promptDialog.close())
    document.getElementById('btn-copy-prompt').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(dom.promptText.value)
        this.toast('Prompt copied to clipboard.')
      } catch {
        dom.promptText.select()
        document.execCommand('copy')
        this.toast('Prompt copied.')
      }
    })
  }

  /* ------------------------------ rendering ------------------------------ */

  render() {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    this.clueStates = new Map(puzzle.clues.map((clue) => [clue.id, evaluateClue(clue, puzzle, grid)]))
    this.clearStaleManualMarks()
    const solved = this.isSolved()
    const becameSolved = this.hasRendered === true && solved && !this.solved
    this.solved = solved
    document.title = `${puzzle.title} — Zebra / Einstein Riddles`
    this.renderToolbar()
    this.renderGrid()
    this.renderClues()
    this.renderContradictions()
    this.renderPopover()
    this.applyHighlight()

    if (becameSolved) this.showSolved()
    else if (!solved) this.closeSolved()
    this.hasRendered = true
  }

  renderToolbar() {
    const { puzzle, ui } = this.store.session
    const grid = this.store.effective
    const total = puzzle.categories.length * puzzle.positions.labels.length
    let filled = 0
    for (const category of puzzle.categories) {
      for (const cell of grid[category.id]) if (cell.length === 1) filled += 1
    }

    this.dom.title.textContent = puzzle.title
    if (this.solved) {
      this.dom.progress.textContent = `Solved — ${filled} / ${total} cells`
      this.dom.progress.classList.add('solved')
    } else {
      this.dom.progress.textContent = `${filled} / ${total} cells filled`
      this.dom.progress.classList.remove('solved')
    }
    this.dom.undo.disabled = !this.store.canUndo()
    this.dom.redo.disabled = !this.store.canRedo()
    this.dom.toggleEliminated.checked = ui.showEliminated
  }

  renderGrid() {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    const labels = puzzle.positions.labels

    const header = `<thead><tr><th class="corner"></th>${labels
      .map(
        (label, index) =>
          `<th class="pos-head" data-pos="${index}">${esc(positionTitle(puzzle, index))}</th>`,
      )
      .join('')}</tr></thead>`

    const body = puzzle.categories
      .map((category) => {
        const cells = grid[category.id]
        const solved = cells.filter((cell) => cell.length === 1).length
        const cellHtml = cells
          .map((cell, position) => this.cellHTML(category, cell, position, solved === cells.length))
          .join('')
        return `<tr><th class="row-head" scope="row">${esc(category.label)}<small>${solved} / ${
          cells.length
        }</small></th>${cellHtml}</tr>`
      })
      .join('')

    this.dom.grid.innerHTML = `${header}<tbody>${body}</tbody>`
  }

  cellHTML(category, cell, position, rowDone) {
    const showEliminated = this.store.session.ui.showEliminated
    const chips = []

    if (cell.length === 1) {
      chips.push(this.chipHTML(category, cell[0], position, 'solved'))
    } else if (cell.length === 0) {
      // dead cell: show the eliminated chips so the user can restore one
      category.values.forEach((_, index) => chips.push(this.chipHTML(category, index, position, 'elim')))
    } else if (showEliminated) {
      category.values.forEach((_, index) => {
        chips.push(this.chipHTML(category, index, position, cell.includes(index) ? '' : 'elim'))
      })
    } else {
      for (const index of cell) chips.push(this.chipHTML(category, index, position, ''))
    }

    const classes = ['cell']
    if (cell.length === 1) classes.push('filled')
    if (cell.length === 0) classes.push('dead')
    if (rowDone) classes.push('row-done')

    return `<td class="${classes.join(' ')}" data-cat="${esc(category.id)}" data-pos="${position}"><div class="chips">${chips.join(
      '',
    )}</div></td>`
  }

  chipHTML(category, index, position, variant) {
    const value = category.values[index]
    const classes = ['chip']
    if (variant) classes.push(variant)
    return `<button type="button" class="${classes.join(' ')}" data-cat="${esc(category.id)}" data-pos="${position}" data-val="${index}" title="${esc(
      value,
    )}" aria-label="${esc(value)}">${esc(value)}</button>`
  }

  renderClues() {
    const { puzzle, clues } = this.store.session
    let done = 0
    let conflicts = 0

    const items = puzzle.clues.map((clue) => {
      const state = this.clueStates.get(clue.id)
      const manual = clues[clue.id]?.manual === true
      const autoDone = state.status === 'satisfied'
      const effective = manual || autoDone
      const autoLocked = autoDone && !manual
      if (effective) done += 1
      if (state.status === 'violated') conflicts += 1

      const classes = ['clue', `s-${state.status}`]
      if (effective) classes.push('done')
      if (manual) classes.push('manual')

      let badge = ''
      if (state.status === 'violated') badge = '<span class="badge bad">conflicts</span>'
      else if (manual) badge = '<span class="badge info">marked done</span>'
      else if (autoDone) badge = '<span class="badge ok">auto-done</span>'
      else if (state.status === 'unknown') badge = '<span class="badge">needs constraint</span>'

      const issue = state.issues.length
        ? `<span class="issue" title="${esc(state.issues.join(' '))}">⚠ ${esc(truncate(state.issues[0], 70))}</span>`
        : ''

      return `<div class="${classes.join(' ')}" data-clue="${esc(clue.id)}">
        <label class="clue-check"><input type="checkbox" ${
          effective ? 'checked' : ''
        } ${autoLocked ? 'disabled title="Satisfied by the current grid — edit the constraint to override"' : ''} aria-label="Mark clue as done" /></label>
        <div class="clue-body">
          <p class="clue-text">${this.clueTextHTML(clue)}</p>
          <div class="clue-meta">${badge}${issue}</div>
          ${this.openClue === clue.id ? this.inspectorHTML(clue, state) : ''}
        </div>
        <button type="button" class="clue-more" data-act="inspect" title="Inspect or edit this clue's constraint">⋯</button>
      </div>`
    })

    this.dom.clueCount.textContent = `${done} / ${puzzle.clues.length} done${
      conflicts ? ` · ${conflicts} conflicting` : ''
    }`
    this.dom.clueList.style.gridTemplateRows = `repeat(${Math.max(
      1,
      Math.ceil(puzzle.clues.length / 2),
    )}, auto)`
    this.dom.clueList.innerHTML = items.join('')
  }

  clueTextHTML(clue) {
    const links = findValueLinks(clue.text, this.store.session.puzzle)
    let html = ''
    let cursor = 0
    for (const link of links) {
      html += esc(clue.text.slice(cursor, link.start))
      html += `<span class="ent" data-cat="${esc(link.categoryId)}" data-idx="${link.index}">${esc(
        clue.text.slice(link.start, link.end),
      )}</span>`
      cursor = link.end
    }
    html += esc(clue.text.slice(cursor))
    return html
  }

  inspectorHTML(clue, state) {
    const checks = state.checks
      .map(
        (check) =>
          `<li class="chk ${check.status}"><span class="dot"></span><span>${esc(
            describeConstraint(check.constraint, this.store.session.puzzle),
          )}</span>${check.reason ? ` <em>${esc(check.reason)}</em>` : ''}</li>`,
      )
      .join('')

    const checksBlock = checks
      ? `<ul class="checks">${checks}</ul>`
      : state.issues.length
        ? `<ul class="checks"><li class="chk unknown"><span class="dot"></span>${esc(
            state.issues.join(' '),
          )}</li></ul>`
        : `<ul class="checks"><li class="chk"><span class="dot"></span><span>No machine-readable constraint. This clue is done once all values it names are placed.</span></li></ul>`

    return `<div class="inspector">
      ${checksBlock}
      <label class="field-label">Constraints JSON</label>
      <textarea class="inspector-json" spellcheck="false">${esc(
        JSON.stringify(clue.constraints, null, 2),
      )}</textarea>
      <div class="inspector-actions">
        <button type="button" class="btn small" data-act="apply-clue">Apply</button>
        <button type="button" class="btn small" data-act="reset-clue">Revert</button>
        <span class="inspector-msg"></span>
      </div>
    </div>`
  }

  renderContradictions() {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    const dead = []
    for (const category of puzzle.categories) {
      grid[category.id].forEach((cell, position) => {
        if (cell.length === 0) dead.push(`${category.label} · ${puzzle.positions.labels[position]}`)
      })
    }
    const failed = puzzle.clues.filter((clue) => this.clueStates.get(clue.id)?.status === 'violated')

    const element = this.dom.contradictions
    if (!dead.length && !failed.length) {
      element.hidden = true
      element.innerHTML = ''
      return
    }

    const rows = []
    if (dead.length) {
      rows.push(
        `<div class="banner-row"><strong>Empty cells</strong><span>${dead.map(esc).join(', ')}</span></div>`,
      )
    }
    if (failed.length) {
      rows.push(
        `<div class="banner-row"><strong>Clues contradicted</strong><span>${failed
          .map((clue) => esc(truncate(clue.text, 90)))
          .join(' · ')}</span></div>`,
      )
    }
    element.innerHTML = `${rows.join(
      '',
    )}<div class="banner-hint">Undo the last elimination, or check that clue's constraint.</div>`
    element.hidden = false
  }

  /* ------------------------------ popover ------------------------------ */

  showPlacedElsewhere(categoryId, valueIndex) {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    const category = puzzle.categories.find((entry) => entry.id === categoryId)
    const value = category?.values[valueIndex] ?? 'That value'
    const holder = grid[categoryId]?.findIndex(
      (cell) => cell.length === 1 && cell[0] === valueIndex,
    )
    const where = holder >= 0 ? positionTitle(puzzle, holder) : 'another cell of this row'
    this.toast(`${value} is already placed in ${where} — it can't be restored here.`)
  }

  openCellPopover(cell) {
    this.popover = { categoryId: cell.dataset.cat, position: Number(cell.dataset.pos) }
    this.anchor = cell.getBoundingClientRect()
    this.renderPopover()
  }

  closePopover() {
    this.popover = null
    this.anchor = null
    this.dom.popover.hidden = true
    this.dom.popover.innerHTML = ''
  }

  renderPopover() {
    const popover = this.dom.popover
    if (!this.popover) {
      popover.hidden = true
      return
    }

    const { puzzle } = this.store.session
    const grid = this.store.effective
    const category = puzzle.categories.find((entry) => entry.id === this.popover.categoryId)
    if (!category) {
      this.closePopover()
      return
    }

    const cells = grid[category.id][this.popover.position]
    const placedElsewhere = new Map()
    grid[category.id].forEach((cell, position) => {
      if (position !== this.popover.position && cell.length === 1) {
        placedElsewhere.set(cell[0], position)
      }
    })

    const rows = category.values
      .map((value, index) => {
        const placedAt = placedElsewhere.get(index)
        const blocked = placedAt !== undefined
        return `<div class="pop-row">
          <label><input type="checkbox" data-val="${index}" ${
            cells.includes(index) ? 'checked' : ''
          } ${blocked ? 'disabled' : ''} /><span>${esc(value)}</span></label>
          ${blocked ? `<span class="pop-note">in ${esc(positionTitle(puzzle, placedAt))}</span>` : ''}
          <button type="button" class="only" data-val="${index}" title="Eliminate every other option" ${
            blocked ? 'disabled' : ''
          }>only</button>
        </div>`
      })
      .join('')

    popover.innerHTML = `<div class="pop-head"><strong>${esc(category.label)}</strong><span class="muted">${esc(
      positionTitle(puzzle, this.popover.position),
    )}</span></div><div class="pop-body">${rows}</div><div class="pop-foot"><button type="button" class="btn small" data-act="pop-close">Done</button></div>`
    popover.hidden = false

    const cell = this.dom.grid.querySelector(
      `td.cell[data-cat="${category.id}"][data-pos="${this.popover.position}"]`,
    )
    if (cell) this.anchor = cell.getBoundingClientRect()
    if (!this.anchor) return

    const width = popover.offsetWidth
    const height = popover.offsetHeight
    let left = Math.min(this.anchor.left, window.innerWidth - width - 12)
    let top = this.anchor.bottom + 6
    if (top + height > window.innerHeight - 12) top = Math.max(12, this.anchor.top - height - 6)
    popover.style.left = `${Math.max(12, left)}px`
    popover.style.top = `${top}px`
  }

  /* ------------------------------ highlights ------------------------------ */

  highlightColumn(position) {
    const heads = this.dom.grid.querySelectorAll('thead th.pos-head')
    heads.forEach((head) => head.classList.toggle('col-hl', Number(head.dataset.pos) === position))
  }

  setHoverRef(ref) {
    this.hoverRef = ref
    this.applyHighlight()
  }

  applyHighlight() {
    const active = this.pinnedRef || this.hoverRef
    const grid = this.dom.grid

    grid.querySelectorAll('.cell.ref-hl').forEach((cell) => cell.classList.remove('ref-hl'))
    grid.querySelectorAll('.chip.ref-hl').forEach((chip) => chip.classList.remove('ref-hl'))
    if (!active) return

    const { puzzle } = this.store.session
    const category = puzzle.categories.find((entry) => entry.id === active.categoryId)
    if (!category) return

    for (const cell of grid.querySelectorAll('td.cell')) {
      if (cell.dataset.cat !== category.id) continue
      const position = Number(cell.dataset.pos)
      const candidates = this.store.effective[category.id][position]
      if (candidates.includes(active.index)) cell.classList.add('ref-hl')
    }

    for (const chip of grid.querySelectorAll('.chip')) {
      if (chip.classList.contains('elim')) continue
      if (chip.dataset.cat === category.id && Number(chip.dataset.val) === active.index) {
        chip.classList.add('ref-hl')
      }
    }
  }

  /* ------------------------------ solved feedback ------------------------------ */

  clearStaleManualMarks() {
    const { puzzle, clues } = this.store.session
    for (const clue of puzzle.clues) {
      if (clues[clue.id]?.manual === true && this.clueStates.get(clue.id)?.status === 'satisfied') {
        this.store.clearClueManual(clue.id)
      }
    }
  }

  isSolved() {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    const allFilled = puzzle.categories.every((category) =>
      grid[category.id].every((cell) => cell.length === 1),
    )
    if (!allFilled) return false
    return puzzle.clues.every((clue) => this.clueStates.get(clue.id)?.status === 'satisfied')
  }

  showSolved() {
    const { puzzle } = this.store.session
    const grid = this.store.effective
    const totalCells = puzzle.categories.length * puzzle.positions.labels.length
    let filled = 0
    for (const category of puzzle.categories) {
      filled += grid[category.id].filter((cell) => cell.length === 1).length
    }

    const satisfied = puzzle.clues.filter(
      (clue) => this.clueStates.get(clue.id)?.status === 'satisfied',
    ).length
    const clueText = puzzle.clues.length
      ? `${satisfied} / ${puzzle.clues.length} clues`
      : 'no clues'

    this.dom.solvedSubtitle.textContent = `${puzzle.title} — ${filled} / ${totalCells} cells, ${clueText}.`
    this.dom.solvedOverlay.hidden = false
    this.dom.solvedClose.focus()
    this.launchConfetti()
  }

  closeSolved() {
    if (!this.dom.solvedOverlay || this.dom.solvedOverlay.hidden) {
      this.clearConfetti()
      return
    }
    this.dom.solvedOverlay.hidden = true
    this.clearConfetti()
  }

  launchConfetti() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const layer = this.dom.confetti
    const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4']
    const fragment = document.createDocumentFragment()

    for (let index = 0; index < 70; index += 1) {
      const piece = document.createElement('span')
      piece.className = 'confetti-piece'
      piece.style.left = `${Math.random() * 100}%`
      piece.style.background = colors[index % colors.length]
      piece.style.animationDelay = `${Math.random() * 0.55}s`
      piece.style.animationDuration = `${2.2 + Math.random() * 1.7}s`
      piece.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 140}px`)
      piece.style.setProperty('--spin', `${(Math.random() * 2 - 1) * 720}deg`)
      fragment.appendChild(piece)
    }

    layer.replaceChildren(fragment)
    clearTimeout(this.confettiTimer)
    this.confettiTimer = setTimeout(() => layer.replaceChildren(), 4800)
  }

  clearConfetti() {
    clearTimeout(this.confettiTimer)
    if (this.dom.confetti) this.dom.confetti.replaceChildren()
  }

  /* ------------------------------ dialogs / toast ------------------------------ */

  openLoadDialog(text) {
    this.showLoadErrors([])
    this.setLoadStatus('')
    this.closeSampleMenu()
    this.dom.loadJson.value = text
    this.dom.loadDialog.showModal()
  }

  showLoadErrors(errors) {
    const list = this.dom.loadErrors
    if (!errors.length) {
      list.hidden = true
      list.innerHTML = ''
      return
    }
    list.innerHTML = errors.map((error) => `<li>${esc(error)}</li>`).join('')
    list.hidden = false
  }

  setLoadStatus(text) {
    const status = this.dom.loadStatus
    status.textContent = text
    status.hidden = !text
  }

  toggleSampleMenu() {
    const show = this.dom.sampleMenu.hidden
    this.dom.sampleMenu.hidden = !show
    this.dom.sampleButton.setAttribute('aria-expanded', String(show))
  }

  closeSampleMenu() {
    this.dom.sampleMenu.hidden = true
    this.dom.sampleButton.setAttribute('aria-expanded', 'false')
  }

  async previewSample(file) {
    this.closeSampleMenu()
    try {
      const response = await fetch(`/samples/${file}`)
      if (!response.ok) throw new Error(`Could not fetch the sample (HTTP ${response.status}).`)
      const sample = await response.json()
      this.dom.loadJson.value = JSON.stringify(sample, null, 2)
      this.showLoadErrors([])
      const title =
        this.dom.sampleMenu.querySelector(`[data-file="${file}"] .menu-title`)?.textContent.trim() ||
        'Sample'
      this.setLoadStatus(`${title} loaded into the editor — press Load to start.`)
      this.dom.loadJson.focus()
    } catch (error) {
      this.setLoadStatus('')
      this.showLoadErrors([error.message])
    }
  }

  applyLoadText(text) {
    if (!text.trim()) {
      this.showLoadErrors(['Paste some JSON first.'])
      return
    }

    let session
    const errors = []
    try {
      session = createSession(parsePuzzle(JSON.parse(text)))
    } catch (error) {
      if (error instanceof PuzzleError) errors.push(...error.errors)
      else if (error instanceof SyntaxError) errors.push(`Invalid JSON: ${error.message}`)
      else errors.push(error.message || String(error))
    }

    if (errors.length) {
      this.showLoadErrors(errors)
      this.setLoadStatus('')
      return
    }

    if (this.hasProgress() && !confirm('Loading will replace the current grid and discard its progress. Continue?')) {
      return
    }

    this.openClue = null
    this.pinnedRef = null
    this.hoverRef = null
    this.closePopover()
    this.store.loadSession(session)
    this.dom.loadDialog.close()
    this.showLoadErrors([])
    this.toast('Puzzle loaded.')
  }

  hasProgress() {
    const { puzzle, clues } = this.store.session
    const grid = this.store.effective
    for (const category of puzzle.categories) {
      for (const cell of grid[category.id]) {
        if (cell.length !== category.values.length) return true
      }
    }
    return Object.values(clues).some((clue) => clue.manual !== null)
  }

  toast(message) {
    const element = this.dom.toast
    element.textContent = message
    element.hidden = false
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      element.hidden = true
    }, 2600)
  }
}
