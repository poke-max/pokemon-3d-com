import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'

async function readRequestBody(req: IncomingMessage): Promise<any> {
  return await new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve(undefined)
      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const require = createRequire(import.meta.url)
const vendorRoot = path.resolve(__dirname, 'vendor/pokemon-showdown')
const vendorSimPath = path.resolve(vendorRoot, 'sim')
const vendorDataPath = path.resolve(vendorRoot, 'data')
const vendorTsconfigPath = path.resolve(vendorRoot, 'tsconfig.json')
const tripleBattleModulePath = path.resolve(
  vendorRoot,
  'apps/triple-battle-demo/TripleBattleComponent.ts'
)
const randomSetsPath = path.resolve(vendorDataPath, 'random-battles/gen9/sets.json')
const randomSets = require(randomSetsPath) as Record<
  string,
  { level?: number; sets?: Array<{ movepool?: string[]; abilities?: string[] }> }
>

const manualSessions = new Map<string, ManualSession>()

interface ManualSession {
  id: string
  streams: any
  battleStream: any
  log: string[]
  request: any | null
  ended: boolean
  winner?: string
  player?: { ident: string; condition: string }
  foe?: { ident: string; condition: string }
  teams?: any
}

let battleModulePromise: Promise<any> | null = null
let tsNodeRegistered = false

const ensureTsNode = () => {
  if (tsNodeRegistered) return
  require('ts-node').register({
    transpileOnly: true,
    project: vendorTsconfigPath,
    compilerOptions: {
      module: 'CommonJS',
      target: 'es2020',
      moduleResolution: 'node',
      esModuleInterop: true,
      downlevelIteration: true,
    },
  })
  tsNodeRegistered = true
}

const getSimModule = () => {
  ensureTsNode()
  return require(vendorSimPath)
}

const loadBattleModule = () => {
  if (!battleModulePromise) {
    battleModulePromise = (async () => {
      ensureTsNode()
      return require(tripleBattleModulePath)
    })()
  }
  return battleModulePromise
}

type StatsTable = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }

interface CatalogSpeciesEntry {
  num: number
  name: string
  spriteId: string
  baseSpecies?: string
  forme?: string
  baseForme?: string
  abilities: string[]
  defaultAbility?: string
  defaultItem?: string
  defaultMoves: string[]
  moves: string[]
  defaultNature: string
  defaultLevel: number
  defaultGender: 'M' | 'F' | 'N' | ''
  defaultEvs: StatsTable
  defaultIvs: StatsTable
  availableGenders: Array<'M' | 'F' | 'N'>
}

interface CatalogPayload {
  species: CatalogSpeciesEntry[]
  items: string[]
  abilities: string[]
  moves: string[]
}

let catalogCache: CatalogPayload | null = null

const SPRITE_ROOT = path.resolve(__dirname, 'src/assets/images/pokemon')
const spriteIndex = new Map<number, string[]>()
let spriteIndexReady = false

const slugifySpriteToken = (value?: string) => {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const ensureSpriteIndex = () => {
  if (spriteIndexReady) return
  spriteIndexReady = true
  if (!fs.existsSync(SPRITE_ROOT)) return
  const entries = fs.readdirSync(SPRITE_ROOT, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const baseName = entry.name.replace(/\.png$/, '')
    const [numToken] = baseName.split('-', 1)
    const num = parseInt(numToken, 10)
    if (Number.isNaN(num)) continue
    const bucket = spriteIndex.get(num) ?? []
    bucket.push(baseName)
    spriteIndex.set(num, bucket)
  }
  for (const [num, list] of spriteIndex.entries()) {
    spriteIndex.set(num, list.sort((a, b) => a.localeCompare(b)))
  }
}

const findSpriteSuffixFromName = (species: any) => {
  if (!species?.baseSpecies || species.baseSpecies === species.name) return ''
  const prefix = `${species.baseSpecies}-`
  if (species.name.startsWith(prefix)) return species.name.slice(prefix.length)
  return species.name
}

const pickSpriteId = (species: any): string => {
  ensureSpriteIndex()
  const num = typeof species?.num === 'number' ? species.num : parseInt(species?.num ?? '', 10)
  if (!num) return ''
  const bucket = spriteIndex.get(num)
  if (!bucket?.length) return String(num)
  const base = String(num)
  if (bucket.includes(base)) return base
  const tokens = new Set<string>()
  const addToken = (token?: string) => {
    const slug = slugifySpriteToken(token)
    if (slug) tokens.add(slug)
  }
  addToken(species?.forme)
  if (slugifySpriteToken(species?.forme) === 'gmax') tokens.add('gigantamax')
  addToken(findSpriteSuffixFromName(species))
  addToken(species?.baseForme)
  if (Array.isArray(species?.requiredItems)) {
    for (const item of species.requiredItems) addToken(item)
  } else {
    addToken(species?.requiredItem)
  }
  const formeTokens = species?.forme?.split(/\s*-\s*/) ?? []
  for (const token of formeTokens) addToken(token)
  if (species?.forme?.includes('Tera')) tokens.add('tera')
  for (const token of tokens) {
    const match = bucket.find((name) => name.includes(token))
    if (match) return match
  }
  return bucket[0]
}

function buildCatalog(): CatalogPayload {
  ensureTsNode()
  const { Dex } = require(vendorSimPath)
  const dex = Dex.forFormat('gen9customgame')
  const species: CatalogSpeciesEntry[] = []
  const items = new Set<string>()
  const abilitySet = new Set<string>()
  const movesSet = new Set<string>()

  for (const mon of dex.species.all()) {
    if (!mon.exists) continue
    if (mon.isNonstandard && !['Future', 'Past'].includes(mon.isNonstandard as string)) continue
    if (mon.gen && mon.gen > 9) continue
    const baseAbilityList = Array.from(new Set(Object.values(mon.abilities).filter(Boolean))) as string[]
    const spriteId = pickSpriteId(mon)

    const randEntry = randomSets[mon.id]
    const randSet = randEntry?.sets?.[0]
    const randomMovePool = randSet?.movepool ?? []
    const randomAbilityPool = randSet?.abilities ?? []

    const abilityOptions = randomAbilityPool.length
      ? Array.from(new Set([...randomAbilityPool, ...baseAbilityList]))
      : baseAbilityList
    const defaultAbility = randomAbilityPool[0] || mon.abilities['0'] || abilityOptions[0]

    const defaultItem = mon.requiredItem || mon.requiredItems?.[0]

    const learnsetData = dex.species.getLearnsetData(mon.id).learnset
    const moveAccumulator = new Set<string>()
    if (learnsetData) {
      for (const moveid in learnsetData) {
        const move = dex.moves.get(moveid)
        if (!move?.exists) continue
        moveAccumulator.add(move.name)
        movesSet.add(move.name)
      }
    }
    for (const moveName of randomMovePool) {
      const move = dex.moves.get(moveName)
      if (!move?.exists) continue
      moveAccumulator.add(move.name)
      movesSet.add(move.name)
    }
    const moveList = Array.from(moveAccumulator).sort((a, b) => a.localeCompare(b))

    const preferredMoves = (
      randomMovePool.length ? randomMovePool : mon.randomBattleMoves || mon.randomDoubleBattleMoves || []
    )
      .map((moveid: string) => {
        const move = dex.moves.get(moveid)
        return move?.exists ? move.name : null
      })
      .filter((name: string | null): name is string => !!name)
      .slice(0, 4)

    const defaultNature = 'Serious'
    const defaultLevel = randEntry?.level ?? 50
    const availableGenders: Array<'M' | 'F' | 'N'> = []
    if (mon.gender === 'M' || mon.gender === 'F' || mon.gender === 'N') {
      availableGenders.push(mon.gender as 'M' | 'F' | 'N')
    } else if (mon.gender === undefined && mon.genderRatio) {
      if (mon.genderRatio.M !== 0) availableGenders.push('M')
      if (mon.genderRatio.F !== 0) availableGenders.push('F')
      if (mon.genderRatio.N) availableGenders.push('N')
    }
    if (!availableGenders.length) availableGenders.push('M', 'F')
    const defaultGender = availableGenders[0] ?? 'N'
    const defaultEvs: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
    const defaultIvs: StatsTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }

    species.push({
      num: mon.num,
      name: mon.name,
      spriteId: spriteId || String(mon.num),
      baseSpecies: mon.baseSpecies !== mon.name ? mon.baseSpecies : undefined,
      forme: mon.forme || undefined,
      baseForme: mon.baseForme || undefined,
      abilities: abilityOptions,
      defaultAbility,
      defaultItem,
      defaultMoves: preferredMoves,
      moves: moveList,
      defaultNature,
      defaultLevel,
      defaultGender,
      defaultEvs,
      defaultIvs,
      availableGenders,
    })
    abilityOptions.forEach((ability) => abilitySet.add(ability))
  }

  for (const item of dex.items.all()) {
    if (!item.exists) continue
    if (item.isNonstandard && item.isNonstandard !== 'Future') continue
    if (item.gen && item.gen > 9) continue
    items.add(item.name)
  }

  const speciesSorted = species.sort((a, b) => a.name.localeCompare(b.name))
  const itemsSorted = Array.from(items).sort((a, b) => a.localeCompare(b))
  const abilitiesSorted = Array.from(abilitySet).sort((a, b) => a.localeCompare(b))
  const movesSorted = Array.from(movesSet).sort((a, b) => a.localeCompare(b))

  return { species: speciesSorted, items: itemsSorted, abilities: abilitiesSorted, moves: movesSorted }
}

const getCatalogData = () => {
  if (!catalogCache) catalogCache = buildCatalog()
  return catalogCache
}

interface ManualBattleStatePayload {
  id: string
  log: string[]
  request: any | null
  ended: boolean
  winner?: string
  player?: { ident: string; condition: string }
  foe?: { ident: string; condition: string }
  teams?: any
}

const summarizeManualRoster = (roster: any[], slotPrefix: 'p1' | 'p2') =>
  roster.map((pokemon, index) => {
    const species = pokemon.species || pokemon.name || `Pokémon ${index + 1}`
    const name = pokemon.name && pokemon.name !== species ? pokemon.name : species
    const level = pokemon.level ?? 50
    const genderSuffix = pokemon.gender && pokemon.gender !== 'N' ? `, ${pokemon.gender}` : ''
    return {
      ident: `${slotPrefix}: ${name}`,
      details: `${species}, L${level}${genderSuffix}`,
      level,
      stats: pokemon.stats ?? pokemon.baseStats ?? null,
      condition: '???',
      currentHp: null,
      maxHp: null,
      moves: Array.isArray(pokemon.moves) ? pokemon.moves.slice() : [],
    }
  })

const updateFoeState = (session: ManualSession, ident: string, condition: string) => {
  session.foe = { ident, condition }
}
const updatePlayerState = (session: ManualSession, ident: string, condition: string) => {
  session.player = { ident, condition }
}

const monitorOmniscient = async (session: ManualSession) => {
  for await (const chunk of session.streams.omniscient) {
    const lines = chunk.split('\n').filter(Boolean)
    session.log.push(...lines)
    for (const line of lines) {
      if (line.startsWith('|win|')) {
        session.ended = true
        session.winner = line.slice(5)
      }
      if (line.startsWith('|switch|p1')) {
        const parts = line.split('|')
        const ident = parts[2]
        const condition = parts[4] ?? parts[3] ?? ''
        updatePlayerState(session, ident, condition)
      } else if (line.startsWith('|switch|p2')) {
        const parts = line.split('|')
        const ident = parts[2]
        const condition = parts[4] ?? parts[3] ?? ''
        updateFoeState(session, ident, condition)
      } else if (line.startsWith('|-damage|p1') || line.startsWith('|-heal|p1')) {
        const parts = line.split('|')
        const ident = parts[2]
        const condition = parts[3] ?? ''
        updatePlayerState(session, ident, condition)
      } else if (line.startsWith('|-damage|p2') || line.startsWith('|-heal|p2')) {
        const parts = line.split('|')
        const ident = parts[2]
        const condition = parts[3] ?? ''
        updateFoeState(session, ident, condition)
      } else if (line.startsWith('|faint|p1')) {
        const ident = line.split('|')[2]
        updatePlayerState(session, ident, '0 fnt')
      } else if (line.startsWith('|faint|p2')) {
        const ident = line.split('|')[2]
        updateFoeState(session, ident, '0 fnt')
      }
    }
  }
}

const monitorP1Stream = async (session: ManualSession) => {
  for await (const chunk of session.streams.p1) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('|request|')) {
        try {
          session.request = JSON.parse(line.slice(9))
        } catch (_error) {
          session.request = null
        }
      }
    }
  }
}

const getSessionState = (session: ManualSession): ManualBattleStatePayload => {
  const state: ManualBattleStatePayload = {
    id: session.id,
    log: session.log.slice(),
    request: session.request,
    ended: session.ended,
    winner: session.winner,
    teams: session.teams,
  }
  if (session.player) state.player = session.player
  if (session.foe) state.foe = session.foe
  return state
}

const waitForInitialRequest = async (session: ManualSession) => {
  if (session.request) return
  await new Promise<void>((resolve) => {
    let elapsed = 0
    const interval = setInterval(() => {
      if (session.request || session.ended || elapsed > 5000) {
        clearInterval(interval)
        resolve()
      }
      elapsed += 100
    }, 100)
  })
}

const createManualSession = async (teams: any) => {
  const sim = getSimModule()
  const { BattleStream, getPlayerStreams, Teams } = sim
  const { IntegratedBattleManager } = require(path.resolve(vendorSimPath, 'tools/integrated-smart-battle'))
  const battleStream = new BattleStream()
  const streams = getPlayerStreams(battleStream)
  const id = typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2)
  const resolvedTeams = teams ?? (await loadBattleModule()).DEFAULT_TEAMS

  const session: ManualSession = {
    id,
    streams,
    battleStream,
    log: [],
    request: null,
    ended: false,
    teams: resolvedTeams,
  }
  manualSessions.set(id, session)
  void monitorOmniscient(session)
  void monitorP1Stream(session)

  const pushLog = (line: string) => {
    if (line.startsWith('|smartai|')) {
      console.info(line)
      return
    }
    session.log.push(line)
  }

  const initialPlayerSnapshot = summarizeManualRoster(resolvedTeams.p1.roster, 'p1')
  pushLog(`|smartai|Tus Pokémon: ${JSON.stringify(initialPlayerSnapshot)}`)
  const initialCpuSnapshot = summarizeManualRoster(resolvedTeams.p2.roster, 'p2')
  pushLog(`|smartai|Pokémon rivales: ${JSON.stringify(initialCpuSnapshot)}`)

  const attachIntegratedAI = () => {
    if (!battleStream.battle) return
    const manager = new IntegratedBattleManager(battleStream.battle)
    manager.register('p2', {
      logger: (message: string) => pushLog(`|smartai|${message}`),
    })
  }

  const spec = { formatid: 'gen9customgame' }
  const startScript = [
    `>start ${JSON.stringify(spec)}`,
    `>player p1 ${JSON.stringify({ name: 'Jugador 1', team: Teams.pack(resolvedTeams.p1.roster) })}`,
    `>player p2 ${JSON.stringify({ name: 'CPU', team: Teams.pack(resolvedTeams.p2.roster) })}`,
  ].join('\n')

  void streams.omniscient.write(startScript)
  attachIntegratedAI()
  return session
}

function tripleBattleApiPlugin(): PluginOption {
  return {
    name: 'triple-battle-api',
    configureServer(server) {
      server.middlewares.use('/api/catalog', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Método no permitido')
          return
        }
        try {
          const catalog = getCatalogData()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(catalog))
        } catch (error: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'Fallo al cargar el catálogo' }))
        }
      })

      server.middlewares.use('/api/simulate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Método no permitido, usa POST.')
          return
        }
        try {
          const payload = await readRequestBody(req)
          const { TripleBattleComponent, DEFAULT_TEAMS } = await loadBattleModule()
          const component = new TripleBattleComponent(payload?.spec)
          const result = await component.simulate(payload?.teams ?? DEFAULT_TEAMS)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (error: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'Fallo la simulación' }))
        }
      })

      server.middlewares.use('/api/manual/start', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Método no permitido')
          return
        }
        try {
          const payload = await readRequestBody(req)
          const session = await createManualSession(payload?.teams)
          await waitForInitialRequest(session)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ id: session.id, state: getSessionState(session) }))
        } catch (error: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'No se pudo iniciar la batalla' }))
        }
      })

      server.middlewares.use('/api/manual/state', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Método no permitido')
          return
        }
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const id = url.searchParams.get('id')
          if (!id || !manualSessions.has(id)) {
            res.statusCode = 404
            res.end('Sesión no encontrada')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getSessionState(manualSessions.get(id)!)))
        } catch (error: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'No se pudo obtener el estado' }))
        }
      })

      server.middlewares.use('/api/manual/state-full', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Método no permitido')
          return
        }
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const id = url.searchParams.get('id')
          if (!id || !manualSessions.has(id)) {
            res.statusCode = 404
            res.end('Sesión no encontrada')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getSessionState(manualSessions.get(id)!)))
        } catch (error: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'No se pudo obtener el estado' }))
        }
      })

      server.middlewares.use('/api/manual/command', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Método no permitido')
          return
        }
        try {
          const payload = await readRequestBody(req)
          const session = payload?.id ? manualSessions.get(payload.id) : null
          if (!session) {
            res.statusCode = 404
            res.end('Sesión no encontrada')
            return
          }
          if (session.ended) {
            res.statusCode = 400
            res.end('La batalla ya terminó')
            return
          }
          console.info('[ManualBattle] Comando recibido:', payload.command)
          await session.streams.p1.write(payload.command)
          console.info('[ManualBattle] Comando enviado al stream p1')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getSessionState(session)))
        } catch (error: any) {
          console.error('[ManualBattle] Error al procesar comando manual:', error)
          res.statusCode = 500
          res.end(JSON.stringify({ message: error?.message ?? 'No se pudo enviar el comando' }))
        }
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'serve' ? tripleBattleApiPlugin() : null].filter(Boolean) as PluginOption[],
}))

