import { POKEMON_NAME_BY_ID } from '../data/dataAssign'

type PokemonSlot = 'p1' | 'p2'
type PokemonSpecies = string

type ManualBattleState = {
  id: string
  log: string[]
  request?: any
  ended?: boolean
  winner?: string
  teams?: any
  player?: { ident: string; condition: string }
  foe?: { ident: string; condition: string }
}

type ManualStartResponse = {
  id: string
  state: ManualBattleState
}

type EventBus = {
  emit: (event: string, payload?: any) => void
}

type BridgeOptions = {
  eventBus: EventBus
  availableSpecies?: PokemonSpecies[]
  pollMs?: number
}

const defaultPollMs = 900

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const buildNameLookup = (allowed: PokemonSpecies[]) => {
  const lookup = new Map<string, PokemonSpecies>()
  const allowSet = new Set(allowed.map((id) => id.padStart(4, '0')))

  Object.entries(POKEMON_NAME_BY_ID).forEach(([id, entries]) => {
    const paddedId = id.padStart(4, '0') as PokemonSpecies
    if (allowSet.size && !allowSet.has(paddedId)) return
    entries.forEach(([, name]) => {
      if (!name) return
      const key = normalizeName(name)
      if (!lookup.has(key)) {
        lookup.set(key, paddedId)
      }
    })
  })

  return lookup
}

const parseConditionHp = (condition?: string | null): { current: number; max: number } | null => {
  if (!condition || typeof condition !== 'string') return null
  const [hpPart] = condition.split(' ')
  if (!hpPart || !hpPart.includes('/')) return null
  const [currentStr, maxStr] = hpPart.split('/')
  const current = Number(currentStr.replace(/[^\d.-]/g, ''))
  const max = Number(maxStr.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(current) || !Number.isFinite(max)) return null
  return { current, max }
}

export class ShowdownBridge {
  private readonly eventBus: EventBus
  private readonly pollMs: number
  private readonly speciesLookup: Map<string, PokemonSpecies>
  private sessionId: string | null = null
  private pollHandle: number | null = null
  private processedLogLines = 0
  private lastRequest: any | null = null
  private slotHp: Record<PokemonSlot, { current: number; max: number }> = {
    p1: { current: 0, max: 0 },
    p2: { current: 0, max: 0 },
  }
  private roster: Record<PokemonSlot, PokemonSpecies[]> = {
    p1: [],
    p2: [],
  }

  constructor({ eventBus, availableSpecies = [], pollMs = defaultPollMs }: BridgeOptions) {
    this.eventBus = eventBus
    this.pollMs = pollMs
    this.speciesLookup = buildNameLookup(availableSpecies)
  }

  async startSession(teams: any) {
    this.stop()
    const response = await fetch('/api/manual/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams }),
    })
    if (!response.ok) {
      throw new Error(`No se pudo iniciar la batalla (${response.status})`)
    }
    const payload = (await response.json()) as ManualStartResponse
    this.sessionId = payload.id
    // Log de ayuda: mostrar el ID de sesión en consola del navegador
    console.log('[ShowdownBridge] Session started:', payload.id)
    this.processedLogLines = 0
    this.eventBus.emit('battle:sim:started', { id: payload.id })
    this.startPolling()
    return payload.id
  }

  attachToSession(id: string) {
    this.stop()
    this.sessionId = id
    // Log de ayuda: mostrar el ID adjuntado en consola del navegador
    console.log('[ShowdownBridge] Session attached:', id)
    this.processedLogLines = 0
    this.eventBus.emit('battle:sim:started', { id })
    this.startPolling()
    return id
  }

  stop() {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle)
      this.pollHandle = null
    }
    this.sessionId = null
    this.processedLogLines = 0
  }

  async sendCommand(command: string) {
    if (!this.sessionId) throw new Error('No hay sesión activa')
    await fetch('/api/manual/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.sessionId, command }),
    })
  }

  private startPolling() {
    if (!this.sessionId) return
    this.pollHandle = window.setInterval(() => {
      void this.pollState()
    }, this.pollMs)
  }

  private async pollState() {
    if (!this.sessionId) return
    const response = await fetch(`/api/manual/state-full?id=${encodeURIComponent(this.sessionId)}`)
    if (!response.ok) {
      console.error('[ShowdownBridge] No se pudo obtener el estado de la sesión')
      return
    }
    const state = (await response.json()) as ManualBattleState
    this.lastRequest = state.request ?? null
    if (state?.teams) {
      this.emitRosterFromTeams(state.teams)
    }
    this.eventBus.emit('battle:sim:request', {
      id: this.sessionId,
      request: this.lastRequest,
      player: state.player,
      foe: state.foe,
    })
    this.updateHpFromState(state)
    this.updateHpFromRequest(this.lastRequest)
    this.consumeLog(state.log ?? [])
    if (state.ended) {
      this.eventBus.emit('battle:sim:ended', { id: this.sessionId, winner: state.winner })
      this.stop()
    }
  }

  private consumeLog(log: string[]) {
    if (!log?.length) return
    const startIndex = Math.max(0, this.processedLogLines)
    const newLines = log.slice(startIndex)
    newLines.forEach((line) => this.handleLogLine(line))
    this.processedLogLines = log.length
  }

  private handleLogLine(raw: string) {
    const line = raw.trim()
    if (!line.startsWith('|')) return
    this.eventBus.emit('battle:sim:logLine', { line })
    if (line.startsWith('|switch|') || line.startsWith('|drag|')) {
      this.handleSwitch(line)
    } else if (line.startsWith('|poke|')) {
      this.handlePoke(line)
    } else if (line.startsWith('|clearpoke|')) {
      this.roster = { p1: [], p2: [] }
      this.emitRoster()
    } else if (line.startsWith('|move|')) {
      this.handleMove(line)
    } else if (line.startsWith('|faint|')) {
      this.handleFaint(line)
    } else if (line.startsWith('|-damage|') || line.startsWith('|-heal|')) {
      this.handleHp(line)
    } else if (line.startsWith('|-status|')) {
      this.handleStatus(line)
    } else if (line.startsWith('|-curestatus|')) {
      this.handleCureStatus(line)
    } else if (line.startsWith('|-boost|') || line.startsWith('|-unboost|')) {
      this.handleStage(line)
    } else if (line.startsWith('|-weather|')) {
      this.handleWeather(line)
    } else if (line.startsWith('|win|')) {
      const winner = line.split('|')[2] ?? ''
      this.eventBus.emit('battle:sim:ended', { id: this.sessionId, winner })
    }
  }

  private extractSlot(token: string): PokemonSlot | null {
    if (token.startsWith('p1')) return 'p1'
    if (token.startsWith('p2')) return 'p2'
    return null
  }

  private resolveSpecies(name: string): PokemonSpecies | null {
    const key = normalizeName(name)
    return this.speciesLookup.get(key) ?? null
  }

  private handleSwitch(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const details = parts[3] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot) return
    const name = details.split(',')[0]?.split(':').pop()?.trim() ?? details
    const species = this.resolveSpecies(name)
    if (!species) {
      console.warn(`[ShowdownBridge] No se pudo mapear la especie "${name}"`)
      return
    }
    const hpInfo = this.extractHp(parts[4] ?? '')
    if (hpInfo) {
      this.slotHp[slot] = { current: hpInfo.current, max: hpInfo.max }
    }
    this.eventBus.emit('pokemon:swap', { slot, species, hp: this.slotHp[slot] })
  }

  private emitRoster(movesBySlot?: Record<PokemonSlot, Record<string, string[]>>) {
    this.eventBus.emit('battle:sim:roster', { roster: { ...this.roster }, movesBySlot })
  }

  private handlePoke(line: string) {
    const parts = line.split('|')
    const sideToken = parts[2] ?? ''
    const details = parts[3] ?? ''
    const slot = sideToken.startsWith('p2') ? 'p2' : 'p1'
    const name = details.split(',')[0]?.split(':').pop()?.trim() ?? details
    const species = this.resolveSpecies(name)
    if (!species) return
    const list = this.roster[slot]
    if (!list.includes(species)) {
      this.roster[slot] = [...list, species]
      this.emitRoster()
    }
  }

  private handleMove(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const move = parts[3] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot || !move) return
  }

  private emitRosterFromTeams(teams: any) {
    if (!teams) return
    const movesBySlot: Record<PokemonSlot, Record<string, string[]>> = { p1: {}, p2: {} }
    const roster: Record<PokemonSlot, PokemonSpecies[]> = { p1: [], p2: [] }
    const slots: PokemonSlot[] = ['p1', 'p2']
    slots.forEach((slot) => {
      const rosterEntries = teams?.[slot]?.roster ?? []
      rosterEntries.forEach((entry: any) => {
        const speciesName = entry?.species || entry?.name || entry?.id
        if (!speciesName) return
        const resolved = this.resolveSpecies(speciesName)
        if (!resolved) return
        roster[slot].push(resolved)
        if (Array.isArray(entry?.moves)) {
          movesBySlot[slot][resolved] = entry.moves
        }
      })
    })
    this.roster = roster
    this.emitRoster(movesBySlot)
  }

  private extractHp(hpToken?: string) {
    if (!hpToken) return null
    const token = hpToken.trim()
    if (!token.includes('/')) return null
    const [currentStr, maxStr] = token.split('/')
    const current = Number(currentStr.replace(/[^\d.-]/g, ''))
    const max = Number(maxStr.replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(current) || !Number.isFinite(max)) return null
    return { current, max }
  }

  private handleStatus(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const status = parts[3] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot || !status) return
    this.eventBus.emit('pokemon:status', { slot, status })
  }

  private handleCureStatus(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot) return
    this.eventBus.emit('pokemon:status', { slot, status: null })
  }

  private handleStage(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const statId = parts[3] ?? ''
    const amountRaw = parts[4] ?? '0'
    const slot = this.extractSlot(ident)
    if (!slot || !statId) return
    const delta = Number(amountRaw)
    if (!Number.isFinite(delta)) return
    this.eventBus.emit('pokemon:stageChange', { slot, stat: statId, delta })
  }

  private handleWeather(line: string) {
    const parts = line.split('|')
    const weatherId = parts[2] ?? ''
    if (!weatherId) return
    const labelMap: Record<string, string> = {
      raindance: 'rain',
      rainy: 'rain',
      sunnyday: 'sunnyday',
      sunny: 'sunnyday',
      sandstorm: 'sandstorm',
      hail: 'snowscape',
      snowscape: 'snowscape',
      deltastream: 'deltastream',
    }
    const key = weatherId.toLowerCase()
    const type = labelMap[key]
    if (!type) return
    const upkeep = (parts[3] ?? '').includes('[upkeep]')
    if (upkeep) return
    const isEnd = (parts[3] ?? '').includes('[end]')
    this.eventBus.emit('battle:weather', { action: isEnd ? 'stop' : 'start', type })
  }

  async sendMoveByName(moveName: string) {
    if (!this.sessionId) throw new Error('No hay sesión activa')
    const move = (this.lastRequest?.active?.[0]?.moves ?? []).find(
      (entry: any) => entry?.name?.toLowerCase() === moveName.toLowerCase()
    )
    const moveIndex = move ? this.lastRequest.active[0].moves.indexOf(move) : -1
    const payload = move
      ? `move ${move.id ?? moveIndex + 1}`
      : `move ${moveName.replace(/\s+/g, '')}`
    return this.sendCommand(payload)
  }

  private handleHp(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot) return
    const hpSpec = parts[3] ?? ''
    const hpData = this.extractHp(hpSpec)
    if (hpData) {
      const prev = this.slotHp[slot]
      const delta = prev?.max ? hpData.current - prev.current : 0
      this.slotHp[slot] = hpData
      this.eventBus.emit('pokemon:hpDelta', { slot, delta, hp: hpData })
    } else {
      const isHeal = line.startsWith('|-heal|')
      const delta = isHeal ? 1 : -1
      this.eventBus.emit('pokemon:hpDelta', { slot, delta })
    }
  }

  private handleFaint(line: string) {
    const parts = line.split('|')
    const ident = parts[2] ?? ''
    const slot = this.extractSlot(ident)
    if (!slot) return
    this.eventBus.emit('pokemon:whiteout', { slot, respawnAfter: false, withParticles: true })
  }

  private updateHpFromState(state: ManualBattleState) {
    const applyCondition = (slot: PokemonSlot, condition?: string | null) => {
      const hpData = parseConditionHp(condition)
      if (!hpData) return
      const prev = this.slotHp[slot]
      const delta = prev?.max ? hpData.current - prev.current : hpData.current
      this.slotHp[slot] = { current: hpData.current, max: hpData.max }
      this.eventBus.emit('pokemon:hpDelta', { slot, delta, hp: this.slotHp[slot] })
    }
    applyCondition('p1', state.player?.condition)
    applyCondition('p2', state.foe?.condition)
  }

  private updateHpFromRequest(request: any) {
    if (!request?.side?.pokemon) return
    const sideMons = request.side.pokemon as Array<any>
    const active = sideMons.find((mon) => mon?.active) ?? sideMons[0]
    if (!active) return
    const hpData = parseConditionHp(active.condition)
    if (!hpData) return
    const prev = this.slotHp.p1
    const delta = prev?.max ? hpData.current - prev.current : hpData.current
    this.slotHp.p1 = { current: hpData.current, max: hpData.max }
    this.eventBus.emit('pokemon:hpDelta', { slot: 'p1', delta, hp: this.slotHp.p1 })
  }
}
