import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import Phaser from 'phaser'

import { enable3d } from '@enable3d/phaser-extension'

import { PlaygroundScene, AVAILABLE_SPECIES_BY_SLOT } from '../phaser/PlaygroundScene'

import { PokemonActionPanel } from './PokemonActionPanel'

import { CameraEffectsPanel } from './CameraEffectsPanel'

import { AttackPanel } from './AttackPanel'

import { CameraControlsUI } from './CameraControlsUI'

import { PokemonSwapPanel } from './PokemonSwapPanel'

import { buildSelfStatusCameraRequest } from './PokemonKnownAnimations'

import type { CameraBehaviorAction, CameraBehaviorRequest } from '../types/cameraBehaviors'

import type { PokemonSelection } from '../phaser/PlaygroundScene'

import type {

  PokemonSlot,

  PokemonSpecies,

  SceneDebugState,

  Vector3Like,

} from '../phaser/PlaygroundScene'

import type { PokemonBattleState } from '../types/pokemonStates'

import type { WeatherEffectType, WeatherTriggerRequest } from '../types/weather'

import { STATUS_LABELS, STAT_LABELS, type PokemonSpeciesMeta, type StatId } from '../data/speciesMeta'

import { POKEMON_NAME_BY_ID } from '../data/dataAssign'

import { Moves } from '../data/moves'



type AnimationPanelPayload = { id: string; names: string[] }[]

type ActionLogEntry = { id: number; message: string; time: string }

type PlayAnimationOptions = { actionId?: string; actionLabel?: string }

type OverlayBarProps = {
  value: number
  current?: number
  max?: number
  hideValue?: boolean
}

type StatusId = keyof typeof STATUS_LABELS

type HpSnapshot = { current: number; max: number; status?: string | null }

type PokemonHpChangePayload = {

  slot: PokemonSlot

  delta: number

  label?: string

  skipDamageAnimation?: boolean

  durationMs?: number

}



type PokemonInstance = {

  uid: string

  selectionId?: string

  species: PokemonSpecies

  form: string

  isRare: boolean

  transformation: string

  nickname: string

  level: number

  maxHp: number

  currentHp: number

  boosts: Partial<Record<StatId, number>>

  status: string | null

  battleState: PokemonBattleState

  moves: string[]

}



type GameState = {

  teams: Record<PokemonSlot, PokemonInstance[]>

  active: Record<PokemonSlot, string | null>

}



let uidCounter = 0

const generateUid = () => `pkm-${Date.now()}-${uidCounter++}`



const buildInitialGameState = (): GameState => ({

  teams: { p1: [], p2: [] },

  active: { p1: null, p2: null },

})



const WEATHER_LABELS: Record<WeatherEffectType, string> = {

  rain: 'Clima: Lluvia',

  snowscape: 'Clima: Snowscape',

  sunnyday: 'Clima: Soleado',

  sandstorm: 'Clima: Tormenta de Arena',

  deltastream: 'Clima: Delta Stream',

}



const getWeatherLabel = (type?: WeatherEffectType) =>

  type ? WEATHER_LABELS[type] ?? `Clima: ${type}` : 'Clima'



const ALL_POKEMON_SLOTS: PokemonSlot[] = ['p1', 'p2']
const SIM_SESSION_STORAGE_KEY = 'showdownSimSessionId'
const RESOLUTIONS = {
  default: { label: 'Default', width: 960, height: 540 },

  '2k': { label: '2K', width: 2560, height: 1440 },

  '4k': { label: '4K', width: 3840, height: 2160 },

} as const

type ResolutionId = keyof typeof RESOLUTIONS

const DAMAGE_STATE_DURATION_MS = 1200

const DEFAULT_HP_ANIMATION_DURATION = 650

const createHpSnapshot = (_speciesId: PokemonSpecies | null | undefined): HpSnapshot => ({
  current: 0,
  max: 0,
  status: null,
})



const clampHpValue = (value: number, max: number) => Math.max(0, Math.min(max, value))



const parseConditionHp = (condition?: string | null): { current: number; max: number } | null => {

  if (!condition || typeof condition !== 'string') return null

  const [hpPart] = condition.split(' ')

  if (!hpPart?.includes('/')) return null

  const [currentStr, maxStr] = hpPart.split('/')

  const current = Number(currentStr?.replace(/[^\d.-]/g, ''))

  const max = Number(maxStr?.replace(/[^\d.-]/g, ''))

  if (!Number.isFinite(current) || !Number.isFinite(max)) return null

  return { current, max }

}



const findInstanceByUid = (state: GameState, slot: PokemonSlot, uid: string | null) => {

  if (!uid) return null

  return state.teams[slot].find((entry) => entry.uid === uid) ?? null

}



const resolveSlotFromDescriptor = (value: string | null | undefined): PokemonSlot => {

  const normalized = (value ?? '').toLowerCase()

  const match = normalized.match(/p\s*([12])/)

  if (match) return match[1] === '2' ? 'p2' : 'p1'

  return normalized.includes('p2') ? 'p2' : 'p1'

}



const findMoveByDisplayName = (moveName: string) => {

  const normalized = moveName.trim().toLowerCase()

  return Object.entries(Moves).find(([, data]) => data.name?.toLowerCase() === normalized)

}



const extractNameFromDescriptor = (value?: string | null) => {

  if (!value) return ''

  const [, namePart] = value.split(':')

  return (namePart ?? value).trim()

}


const normalizeSpeciesName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const ALL_AVAILABLE_SPECIES: PokemonSpecies[] = [
  ...AVAILABLE_SPECIES_BY_SLOT.p1,
  ...AVAILABLE_SPECIES_BY_SLOT.p2,
]

const SPECIES_NAME_LOOKUP: Map<string, PokemonSpecies> = (() => {
  const allowed = new Set(ALL_AVAILABLE_SPECIES.map((id) => id.padStart(4, '0')))
  const lookup = new Map<string, PokemonSpecies>()
  Object.entries(POKEMON_NAME_BY_ID).forEach(([id, entries]) => {
    const paddedId = id.padStart(4, '0') as PokemonSpecies
    if (!allowed.has(paddedId)) return
    entries.forEach(([, name]) => {
      if (!name) return
      const key = normalizeSpeciesName(name)
      if (!lookup.has(key)) {
        lookup.set(key, paddedId)
      }
    })
  })
  return lookup
})()

const resolveSpeciesIdByName = (name?: string | null): PokemonSpecies | null => {
  if (!name) return null
  const key = normalizeSpeciesName(name)
  return SPECIES_NAME_LOOKUP.get(key) ?? null
}



const resolveSlotNickname = (

  slot: PokemonSlot,

  selectionsRef: React.MutableRefObject<Record<PokemonSlot, PokemonSelection | null>>

) => {

  const nickname =

    selectionsRef.current[slot]?.nickname || selectionsRef.current[slot]?.id || slot.toUpperCase()

  return nickname

}



const buildSelectionForSpecies = (

  slot: PokemonSlot,

  speciesId: PokemonSpecies,

  nickname?: string,

  moves?: string[]

): PokemonSelection => {

  const moveList: string[] = Array.isArray(moves) ? moves : []

  return {

    id: speciesId,

    selectionId: `${slot}-${speciesId}`,

    form: '00_00',

    isRare: false,

    transformation: 'normal',

    nickname: nickname || speciesId,

    level: 50,

    moves: moveList,

    maxHp: createHpSnapshot(speciesId).max,

  }

}



const BATTLE_STATE_META: Record<

  Exclude<PokemonBattleState, null>,

  { label: string; description: string; color: string }

> = {

  debilitado: { label: 'Debilitado', description: 'El Pokemon no puede continuar.', color: '#c24155' },

  contactAttack: { label: 'Ataque Contacto', description: 'Ejecutando ataque de contacto.', color: '#3b8cff' },

  rangedAttack: { label: 'Ataque Distancia', description: 'Ejecutando ataque a distancia.', color: '#f6b950' },

  statusAttack: { label: 'Accion de Estado', description: 'Aplicando efecto de estado.', color: '#9c6bff' },

  swap: { label: 'Cambio', description: 'El Pokemon esta siendo cambiado.', color: '#46b5b1' },

  takingDamage: { label: 'Recibiendo da+¦o', description: 'El Pokemon esta recibiendo da+¦o.', color: '#f97316' },

  weather: { label: 'Clima', description: 'Efectos de clima activos.', color: '#5bc0ff' },

}



function SampleHealthBar({ value, current, max, hideValue }: OverlayBarProps) {

  const percent = Math.max(0, Math.min(100, value))

  return (

    <div className="health-bar">

      <div className="health-bar__track">

        <div

          className="health-bar__fill"

          style={{ width: `${percent}%` }}

        />

      </div>

      {!hideValue &&

        (current !== undefined && max !== undefined ? (

          <span className="health-bar__value">

            {current}/{max}

          </span>

        ) : (

          <span className="health-bar__value">{percent}%</span>

        ))}

    </div>

  )

}



const isPokemonSlotId = (value: string): value is PokemonSlot => value === 'p1' || value === 'p2'



export function PhaserCanvas() {

  const containerRef = useRef<HTMLDivElement | null>(null)

  const shellRef = useRef<HTMLDivElement | null>(null)

  const gameRef = useRef<Phaser.Game | null>(null)

  const resolutionOptions = useMemo(

    () =>

      Object.entries(RESOLUTIONS).map(([id, config]) => ({

        id: id as ResolutionId,

        label: config.label,

      })),

    []

  )

  const [animationPanels, setAnimationPanels] = useState<AnimationPanelPayload>([])

  const [sceneDebugState, setSceneDebugState] = useState<SceneDebugState>()

  const [gameState, setGameState] = useState<GameState>(() => buildInitialGameState())

  const [battleStates, setBattleStates] = useState<Record<PokemonSlot, PokemonBattleState>>({

    p1: null,

    p2: null,

  })

  const battleStatesRef = useRef(battleStates)

  const [slotSelections, setSlotSelections] = useState<Record<PokemonSlot, PokemonSelection | null>>({

    p1: null,

    p2: null,

  })

  const [slotSpecies, setSlotSpecies] = useState<Record<PokemonSlot, PokemonSpecies | null>>({

    p1: null,

    p2: null,

  })

  const [slotHealth, setSlotHealth] = useState<Record<PokemonSlot, HpSnapshot>>({

    p1: { current: 0, max: 0, status: null },

    p2: { current: 0, max: 0, status: null },

  })

  const [slotStages, setSlotStages] = useState<Record<PokemonSlot, Partial<Record<StatId, number>>>>({

    p1: {},

    p2: {},

  })

  const [resolution, setResolution] = useState<ResolutionId>('default')

  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({

    width: RESOLUTIONS.default.width,

    height: RESOLUTIONS.default.height,

  })

  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([])

  const [weatherActive, setWeatherActive] = useState(false)

  const [activeWeatherType, setActiveWeatherType] = useState<WeatherEffectType | null>(null)

  const [battleFeed, setBattleFeed] = useState<string[]>([])

  const [commandInput, setCommandInput] = useState('move|p1a: Meowscarada|Flower Trick|p2a: Clodsire')

  const [isCommandRunning, setIsCommandRunning] = useState(false)

  const [simSessionId, setSimSessionId] = useState<string | null>(null)

  const [attachSessionIdInput, setAttachSessionIdInput] = useState('')

  const [teamOrder, setTeamOrder] = useState('123')

  const [backendTeams, setBackendTeams] = useState<Record<PokemonSlot, PokemonSelection[]>>({

    p1: [],

    p2: [],

  })

  const logCounterRef = useRef(0)

  const activeInstances = useMemo(() => {

    return {

      p1: findInstanceByUid(gameState, 'p1', gameState.active.p1),

      p2: findInstanceByUid(gameState, 'p2', gameState.active.p2),

    }

  }, [gameState])

  const slotSpeciesStateRef = useRef(slotSpecies)

  const slotSelectionsRef = useRef(slotSelections)

  const slotHealthRef = useRef(slotHealth)

  const slotStagesRef = useRef(slotStages)

  const backendTeamsRef = useRef(backendTeams)

  const rosterAppliedRef = useRef(false)

  const healthAnimationRef = useRef<Record<PokemonSlot, number | null>>({

    p1: null,

    p2: null,

  })

  const damageStateRestoreRef = useRef<Record<PokemonSlot, PokemonBattleState | null>>({

    p1: null,

    p2: null,

  })

  const damageStateTimerRef = useRef<Record<PokemonSlot, ReturnType<typeof window.setTimeout> | null>>({

    p1: null,

    p2: null,

  })

  const stageFxCounterRef = useRef<Record<PokemonSlot, number>>({ p1: 0, p2: 0 })

  const stageFxQueueRef = useRef<Record<PokemonSlot, { stat: StatId; delta: number }[]>>({

    p1: [],

    p2: [],

  })

  const stageFxActiveStackRef = useRef<Record<PokemonSlot, { stat: StatId; delta: number }[]>>({

    p1: [],

    p2: [],

  })

  const [isFullscreen, setIsFullscreen] = useState(false)

  const [isScheduledPlaying, setIsScheduledPlaying] = useState(false)

  const scheduledCleanupRef = useRef<(() => void)[]>([])

  const scheduledAbortRef = useRef(false)

  const protocolCommandRef = useRef<(command: string) => void>(() => { })

  slotSpeciesStateRef.current = slotSpecies

  slotSelectionsRef.current = slotSelections

  slotHealthRef.current = slotHealth

  slotStagesRef.current = slotStages

  backendTeamsRef.current = backendTeams



  useEffect(() => {

    const nextSpecies: Record<PokemonSlot, PokemonSpecies | null> = {

      p1: activeInstances.p1?.species ?? null,

      p2: activeInstances.p2?.species ?? null,

    }

    const nextSelections: Record<PokemonSlot, PokemonSelection | null> = {

      p1: activeInstances.p1

        ? {

          id: activeInstances.p1.species,

          selectionId: activeInstances.p1.selectionId,

          form: activeInstances.p1.form,

          isRare: activeInstances.p1.isRare,

          transformation: activeInstances.p1.transformation,

          nickname: activeInstances.p1.nickname,

          level: activeInstances.p1.level,

          moves: activeInstances.p1.moves,

          maxHp: activeInstances.p1.maxHp,

        }

        : null,

      p2: activeInstances.p2

        ? {

          id: activeInstances.p2.species,

          selectionId: activeInstances.p2.selectionId,

          form: activeInstances.p2.form,

          isRare: activeInstances.p2.isRare,

          transformation: activeInstances.p2.transformation,

          nickname: activeInstances.p2.nickname,

          level: activeInstances.p2.level,

          moves: activeInstances.p2.moves,

          maxHp: activeInstances.p2.maxHp,

        }

        : null,

    }

    setSlotSpecies(nextSpecies)

    setSlotSelections(nextSelections)

    const nextHealth: Record<PokemonSlot, HpSnapshot> = {

      p1: {

        current: activeInstances.p1?.currentHp ?? 0,

        max: activeInstances.p1?.maxHp ?? 0,

      },

      p2: {

        current: activeInstances.p2?.currentHp ?? 0,

        max: activeInstances.p2?.maxHp ?? 0,

      },

    }

    setSlotHealth(nextHealth)

    slotHealthRef.current = nextHealth

    const nextStages: Record<PokemonSlot, Partial<Record<StatId, number>>> = {

      p1: activeInstances.p1?.boosts ?? {},

      p2: activeInstances.p2?.boosts ?? {},

    }

    setSlotStages(nextStages)

    slotStagesRef.current = nextStages

  }, [activeInstances])



  useEffect(() => {

    console.log('[GameState]', gameState)

  }, [gameState])



  const appendLogEntry = useCallback((message: string) => {

    const entry: ActionLogEntry = {

      id: logCounterRef.current++,

      message,

      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),

    }

    setActionLog((current) => [entry, ...current].slice(0, 20))

  }, [])



  useEffect(() => {

    battleStatesRef.current = battleStates

  }, [battleStates])



  const handleSetBattleState = (slot: PokemonSlot, state: PokemonBattleState) => {

    battleStatesRef.current = { ...battleStatesRef.current, [slot]: state }

    setBattleStates((current) => ({ ...current, [slot]: state }))

  }

  const handleLogEvent = (message: string) => {

    appendLogEntry(message)

  }

  const handleClearLog = () => {

    setActionLog([])

  }




  useEffect(() => {
    if (simSessionId) return
    const stored = typeof window !== 'undefined' ? window.localStorage?.getItem(SIM_SESSION_STORAGE_KEY) : null
    if (!stored) return
    const bridge = (window as any)?.showdownBridge
    if (!bridge?.attach) return
    bridge
      .attach(stored)
      ?.then(() => {
        setSimSessionId(stored)
        rosterAppliedRef.current = false
      })
      ?.catch((err: unknown) =>
        appendLogEntry(`No se pudo adjuntar a la sesion guardada: ${String(err)}`)
      )
  }, [simSessionId, appendLogEntry])

  const startSimSession = async () => {
    try {
      const id = await (window as any)?.showdownBridge?.start()
      if (id) {
        setSimSessionId(id)
        try {
          window.localStorage?.setItem(SIM_SESSION_STORAGE_KEY, id)
        } catch (err) {
          console.warn('[SimSession] No se pudo guardar el ID de sesion', err)
        }
      }
      rosterAppliedRef.current = false
    } catch (error) {
      appendLogEntry(`No se pudo iniciar la sesion del simulador: ${String(error)}`)
    }
  }

  const attachSimSession = async () => {
    if (!attachSessionIdInput.trim()) return
    try {
      const id = await (window as any)?.showdownBridge?.attach(attachSessionIdInput.trim())
      if (id) {
        setSimSessionId(id)
        try {
          window.localStorage?.setItem(SIM_SESSION_STORAGE_KEY, id)
        } catch (err) {
          console.warn('[SimSession] No se pudo guardar el ID de sesion', err)
        }
      }
      rosterAppliedRef.current = false
    } catch (error) {
      appendLogEntry(`No se pudo adjuntar a la sesion: ${String(error)}`)
    }
  }

  const stopSimSession = () => {
    ; (window as any)?.showdownBridge?.stop()
    setSimSessionId(null)
    try {
      window.localStorage?.removeItem(SIM_SESSION_STORAGE_KEY)
    } catch (err) {
      console.warn('[SimSession] No se pudo limpiar el ID de sesion', err)
    }
    appendLogEntry('sesion del simulador detenida.')
  }

  const sendTeamOrder = async () => {

    if (!teamOrder.trim()) return

    try {

      await (window as any)?.showdownBridge?.command?.(`team ${teamOrder.trim()}`)

      appendLogEntry(`Orden de equipo enviada: ${teamOrder.trim()}`)

    } catch (error) {

      appendLogEntry(`No se pudo enviar la orden: ${String(error)}`)

    }

  }



  useEffect(() => {

    if (rosterAppliedRef.current) return

    const total = (backendTeams.p1?.length ?? 0) + (backendTeams.p2?.length ?? 0)

    if (total === 0) return

    const buildInstances = (slot: PokemonSlot) =>

      (backendTeams[slot] ?? []).map((selection) => {

        const hp = createHpSnapshot(selection.id)

        const maxHp = selection.maxHp ?? hp.max

        return {

          uid: generateUid(),

          selectionId: selection.selectionId,

          species: selection.id,

          form: selection.form,

          isRare: selection.isRare,

          transformation: selection.transformation,

          nickname: selection.nickname,

          level: selection.level ?? 50,

          maxHp,

          currentHp: maxHp,

          boosts: {},

          status: null,

          battleState: null,

          moves: selection.moves ?? [],

        } as PokemonInstance

      })

    const teams = {

      p1: buildInstances('p1'),

      p2: buildInstances('p2'),

    }

    setGameState({

      teams,

      active: { p1: teams.p1[0]?.uid ?? null, p2: teams.p2[0]?.uid ?? null },

    })

    setSlotSelections({

      p1: backendTeams.p1[0] ?? null,

      p2: backendTeams.p2[0] ?? null,

    })

    setSlotSpecies({

      p1: backendTeams.p1[0]?.id ?? null,

      p2: backendTeams.p2[0]?.id ?? null,

    })

    setSlotHealth({

      p1: backendTeams.p1[0] ? createHpSnapshot(backendTeams.p1[0].id) : { current: 0, max: 0, status: null },

      p2: backendTeams.p2[0] ? createHpSnapshot(backendTeams.p2[0].id) : { current: 0, max: 0, status: null },

    })

    rosterAppliedRef.current = true

  }, [backendTeams])



  useEffect(() => {

    return () => {

      scheduledAbortRef.current = true

      scheduledCleanupRef.current.forEach((cleanup) => cleanup())

      scheduledCleanupRef.current = []

      ALL_POKEMON_SLOTS.forEach((slot) => {

        const rafId = healthAnimationRef.current[slot]

        if (rafId !== null) {

          window.cancelAnimationFrame(rafId)

          healthAnimationRef.current[slot] = null

        }

        const timerId = damageStateTimerRef.current[slot]

        if (timerId) {

          window.clearTimeout(timerId)

          damageStateTimerRef.current[slot] = null

        }

      })

    }

  }, [])



  useEffect(() => {

    const handleFullscreenChange = () => {

      const target = shellRef.current

      setIsFullscreen(!!target && document.fullscreenElement === target)

    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {

      document.removeEventListener('fullscreenchange', handleFullscreenChange)

    }

  }, [])



  useEffect(() => {

    const game = gameRef.current

    const shell = shellRef.current

    let width: number

    let height: number

    if (isFullscreen && shell) {

      width = shell.clientWidth

      height = shell.clientHeight

    } else {

      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

      const base = RESOLUTIONS[resolution]

      width = isMobile ? 540 : base.width

      height = isMobile ? 960 : base.height

    }

    setCanvasSize({ width, height })

    if (game) {

      game.scale.resize(width, height)

      game.canvas.style.width = `${width}px`

      game.canvas.style.height = `${height}px`

    }

  }, [resolution, isFullscreen])



  const getHpPercent = (meta?: PokemonSpeciesMeta) => {
    if (!meta || !meta.hp.max) return 0
    return Math.max(0, Math.min(100, (meta.hp.current / meta.hp.max) * 100))
  }

  const clampStage = (value: number) => Math.max(-6, Math.min(6, value))

  const formatStage = (value: number) => (value > 0 ? `+${value}` : `${value}`)

  const renderStatStages = (meta?: PokemonSpeciesMeta) => {
    if (!meta?.stages) return null
    const entries = (Object.keys(STAT_LABELS) as StatId[])
      .map((key) => {
        const stage = clampStage(meta.stages?.[key] ?? 0)
        return { key, label: STAT_LABELS[key], stage }
      })
      .filter(({ stage }) => stage !== 0)
    if (!entries.length) return null
    return (
      <div className="stat-stages">
        {entries.map(({ key, label, stage }) => (
          <span
            key={key}
            className={`stat-stage__chip ${stage > 0 ? 'is-positive' : 'is-negative'}`}
          >
            {label}: {formatStage(stage)}
          </span>
        ))}
      </div>
    )
  }

  const resolveSlotMeta = (slot: PokemonSlot) => {
    const instance = activeInstances[slot]
    const selection = slotSelections[slot]
    if (!instance && !selection) return undefined

    const speciesId = instance?.species ?? selection?.id
    if (!speciesId) return undefined

    const slotHp = slotHealth[slot]
    const currentHp = Math.round(
      Number.isFinite(slotHp?.current) && slotHp.current > 0
        ? slotHp.current
        : instance?.currentHp ?? selection?.maxHp ?? 0
    )

    const maxHp =
      Number.isFinite(slotHp?.max) && slotHp.max > 0
        ? slotHp.max
        : instance?.maxHp ?? selection?.maxHp ?? 0

    const stagesState = instance?.boosts ?? {}
    const rawStatus =
      slotHp?.status ??
      (instance?.status as string | null | undefined) ??
      ((selection as any)?.status as string | null | undefined) ??
      null
    const status: StatusId | undefined =
      rawStatus && STATUS_LABELS[rawStatus as StatusId] ? (rawStatus as StatusId) : undefined

    const result: PokemonSpeciesMeta = {
      name: speciesId,
      nickname: instance?.nickname || selection?.nickname || speciesId,
      level: instance?.level ?? selection?.level ?? 0,
      hp: {
        current: currentHp,
        max: maxHp,
      },
      status,
      stages: stagesState && Object.keys(stagesState).length ? stagesState : {},
    }
    console.log(`[PhaserCanvas] resolveSlotMeta(${slot}) ->`, result)
    return result
  }

  useEffect(() => {
    let disposed = false
    const container = containerRef.current
    if (!container) return

    let unsubscribe: (() => void) | undefined

    enable3d(() => {
      if (!containerRef.current || disposed) return

      // Detectar si es m+¦vil
      const isMobile = window.innerWidth < 768

      const game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: containerRef.current,
        transparent: true,
        backgroundColor: '#050b14',
        scene: [PlaygroundScene],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: isMobile ? 540 : 960,
          height: isMobile ? 960 : 540,
        },
      })

      gameRef.current = game
      game.canvas.style.pointerEvents = 'none'

      const handleAnimations = (payload: AnimationPanelPayload) => {
        setAnimationPanels(payload)
      }

      const handleSimRoster = ({
        roster,
        movesBySlot,
      }: {
        roster: Record<PokemonSlot, PokemonSpecies[]>
        movesBySlot?: Record<PokemonSlot, Record<string, string[]>>
      }) => {
        const buildTeam = (slot: PokemonSlot) =>
          (roster?.[slot] ?? []).map((species) =>
            buildSelectionForSpecies(
              slot,
              species,
              undefined,
              movesBySlot?.[slot]?.[species] ?? backendTeamsRef.current[slot]?.find((e) => e.id === species)?.moves
            )
          )
        const nextTeams: Record<PokemonSlot, PokemonSelection[]> = {
          p1: buildTeam('p1'),
          p2: buildTeam('p2'),
        }
        rosterAppliedRef.current = false
        setBackendTeams(nextTeams)
      }

      const handleSimRequest = ({ request, foe, player }: { request: any; foe?: any; player?: any }) => {
        // P1 Logic
        const sideMons: any[] = request?.side?.pokemon ?? []
        const playerData = player ?? request?.player

        let activeMon = sideMons.find((m) => m?.active) ?? sideMons[0]
        if (!activeMon && playerData && (!sideMons || sideMons.length === 0)) {
          activeMon = Array.isArray(playerData.pokemon)
            ? playerData.pokemon.find((m: any) => m.active) ?? playerData.pokemon[0]
            : playerData
        }

        if (activeMon) {
          const condition = activeMon.condition || activeMon.status
          const hpData = parseConditionHp(condition)
          if (hpData) {
            setSlotHealth((current) => ({ ...current, p1: { current: hpData.current, max: hpData.max } }))
            setGameState((current) => {
              const activeUid = current.active.p1
              if (!activeUid) return current
              const team = current.teams.p1 ?? []
              const idx = team.findIndex((entry) => entry.uid === activeUid)
              if (idx < 0) return current
              const nextTeam = [...team]
              nextTeam[idx] = { ...team[idx], currentHp: hpData.current, maxHp: hpData.max }
              return { ...current, teams: { ...current.teams, p1: nextTeam } }
            })
          }
          const statusToken = (() => {
            const cond: string = condition ?? ''
            const parts = cond.split(' ')
            return parts.length > 1 ? parts[1]?.toLowerCase?.() ?? null : null
          })()
          const movesRaw = activeMon.moves?.map((m: any) => m?.name || m?.move)?.filter(Boolean) ?? []
          setSlotSelections((current) => ({
            ...current,
            p1: current.p1
              ? {
                ...current.p1,
                moves: movesRaw.length ? movesRaw : current.p1.moves,
              }
              : current.p1,
          }))

          if (sideMons.length > 0) {
            const nextTeamP1: PokemonInstance[] = sideMons.map((mon, idx) => {
              const hpInfo = parseConditionHp(mon.condition)
              const baseSelection = backendTeamsRef.current.p1[idx] ?? slotSelectionsRef.current.p1
              const identName = mon.ident ? mon.ident.split(':')?.[1]?.trim() : null
              const speciesName =
                mon.details ? mon.details.split(',')[0].trim() : identName ?? baseSelection?.id ?? 'p1'
              const resolvedSpecies = resolveSpeciesIdByName(speciesName) ?? baseSelection?.id ?? null
              const speciesId = (resolvedSpecies ?? 'p1') as PokemonSpecies
              const nickname =
                mon.ident?.split(':')?.[1]?.trim() || baseSelection?.nickname || speciesName
              const level =
                Number((mon.details || '').match(/L(\d+)/)?.[1]) || baseSelection?.level || 50
              const maxHp = hpInfo?.max ?? baseSelection?.maxHp ?? createHpSnapshot(speciesId).max
              const currentHp = hpInfo?.current ?? baseSelection?.maxHp ?? maxHp
              const statusFromCondition = (() => {
                const cond: string = mon.condition ?? ''
                const parts = cond.split(' ')
                return parts.length > 1 ? parts[1]?.toLowerCase?.() ?? null : null
              })()
              return {
                uid: generateUid(),
                selectionId: baseSelection?.selectionId ?? `${'p1'}-${speciesId}`,
                species: speciesId,
                form: baseSelection?.form ?? '00_00',
                isRare: baseSelection?.isRare ?? false,
                transformation: baseSelection?.transformation ?? 'normal',
                nickname,
                level,
                maxHp,
                currentHp,
                boosts: mon.boosts ?? {},
                status: statusFromCondition ?? statusToken,
                battleState: null,
                moves: (mon.moves ?? []).map((m: any) => m?.name || m?.move).filter(Boolean),
              }
            })
            if (nextTeamP1.length) {
              const nextSelectionsP1: PokemonSelection[] = nextTeamP1.map((mon) => ({
                id: mon.species,
                selectionId: mon.selectionId,
                form: mon.form,
                isRare: mon.isRare,
                transformation: mon.transformation,
                nickname: mon.nickname,
                level: mon.level,
                moves: mon.moves,
                maxHp: mon.maxHp,
              }))
              setBackendTeams((current) => ({ ...current, p1: nextSelectionsP1 }))
              setGameState((current) => ({
                teams: { ...current.teams, p1: nextTeamP1 },
                active: {
                  ...current.active,
                  p1:
                    nextTeamP1.find((m) => m.selectionId === slotSelectionsRef.current.p1?.selectionId)?.uid ??
                    nextTeamP1[0]?.uid ??
                    null,
                },
              }))
            }
          } else if (activeMon) {
            if (activeMon.ident || activeMon.name || activeMon.details) {
              setSlotSelections((current) => {
                const currentP1 = current.p1
                const identName = activeMon.ident ? activeMon.ident.split(':')[1]?.trim() : null
                const speciesName = activeMon.details ? activeMon.details.split(',')[0].trim() : (identName ?? currentP1?.id ?? 'p1')
                const speciesId = resolveSpeciesIdByName(speciesName) ?? currentP1?.id ?? ('p1' as PokemonSpecies)

                const base = currentP1 ?? {
                  id: speciesId,
                  selectionId: 'p1-sim',
                  form: '00_00',
                  isRare: false,
                  transformation: 'normal',
                  nickname: activeMon.name || identName || speciesName,
                  level: 50,
                  moves: [],
                  maxHp: hpData?.max ?? 100
                }

                return {
                  ...current,
                  p1: {
                    ...base,
                    id: speciesId,
                    nickname: activeMon.name || identName || base.nickname,
                    level: Number((activeMon.details || '').match(/L(\d+)/)?.[1]) || base.level,
                    maxHp: hpData?.max ?? base.maxHp
                  }
                }
              })
            }
          }
        }

        const foeData = foe ?? request?.foe
        console.log('[PhaserCanvas] handleSimRequest foe:', foeData)
        if (foeData) {
          const activeFoe = Array.isArray(foeData.pokemon)
            ? foeData.pokemon.find((m: any) => m.active) ?? foeData.pokemon[0]
            : foeData

          if (activeFoe) {
            const condition = activeFoe.condition || activeFoe.status
            const hpDataFoe = parseConditionHp(condition)

            const statusTokenFoe = (() => {
              const cond: string = condition ?? ''
              const parts = cond.split(' ')
              return parts.length > 1 ? parts[1]?.toLowerCase?.() ?? null : null
            })()

            if (hpDataFoe) {
              setSlotHealth((current) => ({
                ...current,
                p2: { current: hpDataFoe.current, max: hpDataFoe.max, status: statusTokenFoe },
              }))
              setGameState((current) => {
                const activeUid = current.active.p2
                if (!activeUid) return current
                const team = current.teams.p2 ?? []
                const idx = team.findIndex((entry) => entry.uid === activeUid)
                if (idx < 0) return current
                const nextTeam = [...team]
                nextTeam[idx] = {
                  ...team[idx],
                  currentHp: hpDataFoe.current,
                  maxHp: hpDataFoe.max,
                  status: statusTokenFoe ?? null,
                }
                return { ...current, teams: { ...current.teams, p2: nextTeam } }
              })
            }

            if (activeFoe.ident || activeFoe.name || activeFoe.details) {
              setSlotSelections((current) => {
                const currentP2 = current.p2
                const identName = activeFoe.ident ? activeFoe.ident.split(':')[1]?.trim() : null
                const speciesName = activeFoe.details ? activeFoe.details.split(',')[0].trim() : (identName ?? currentP2?.id ?? 'p2')
                const speciesId = resolveSpeciesIdByName(speciesName) ?? currentP2?.id ?? ('p2' as PokemonSpecies)

                const base = currentP2 ?? {
                  id: speciesId,
                  selectionId: 'p2-sim',
                  form: '00_00',
                  isRare: false,
                  transformation: 'normal',
                  nickname: activeFoe.name || identName || speciesName,
                  level: 50,
                  moves: [],
                  maxHp: hpDataFoe?.max ?? 100
                }

                return {
                  ...current,
                  p2: {
                    ...base,
                    id: speciesId,
                    nickname: activeFoe.name || identName || base.nickname,
                    level: Number((activeFoe.details || '').match(/L(\d+)/)?.[1]) || base.level,
                    maxHp: hpDataFoe?.max ?? base.maxHp
                  }
                }
              })
            }
          }
        }
      }

      const handleSimStarted = ({ id }: { id: string }) => {
        setSimSessionId(id)
        try {
          window.localStorage?.setItem(SIM_SESSION_STORAGE_KEY, id)
        } catch (err) {
          console.warn('[SimSession] No se pudo guardar el ID de sesion', err)
        }
      }

      const handleDebugState = (payload: SceneDebugState) => {
        setSceneDebugState(payload)
      }

      const handleActionComplete = ({
        id,
        initiatorId,
        label,
      }: {
        id: string
        initiatorId?: string
        label?: string
      }) => {
        if (initiatorId && isPokemonSlotId(initiatorId)) {
          setBattleStates((current) => {
            const state = current[initiatorId]
            if (
              state === 'contactAttack' ||
              state === 'rangedAttack' ||
              state === 'statusAttack' ||
              state === 'swap'
            ) {
              const next = { ...current, [initiatorId]: null }
              battleStatesRef.current = next
              return next
            }
            return current
          })
        }
        appendLogEntry(`Finaliza accion ${label ?? id}`)
      }

      const handleActionStart = ({
        id,
        initiatorId,
        label,
      }: {
        id: string
        initiatorId?: string
        label?: string
      }) => {
        appendLogEntry(
          `Empieza accion ${label ?? id}${initiatorId ? ` (${initiatorId.toUpperCase()})` : ''}`
        )
      }

      const handleSlotEmpty = ({ slot }: { slot: PokemonSlot }) => {
        setSlotSpecies((current) => ({ ...current, [slot]: null }))
        setBattleStates((current) => {
          const next = { ...current, [slot]: 'debilitado' }
          battleStatesRef.current = next
          return next
        })
        appendLogEntry(`El slot ${slot.toUpperCase()} ha quedado vacio. Selecciona un nuevo Pokemon para continuar.`)
      }

      const handleHpDeltaEvent = (payload: PokemonHpChangePayload) => {
        applyHpDeltaRef.current(payload.slot, payload.delta, {
          label: payload.label,
          skipDamageAnimation: payload.skipDamageAnimation,
          durationMs: payload.durationMs,
        })
      }

      const handleWeatherComplete = () => {
        setWeatherActive(false)
        setActiveWeatherType(null)
      }

      const handleStageFxStart = ({ slot }: { slot: PokemonSlot }) => {
        stageFxCounterRef.current[slot] = (stageFxCounterRef.current[slot] ?? 0) + 1
        const queue = stageFxQueueRef.current[slot] ?? []
        const entry = queue.shift() ?? null
        stageFxQueueRef.current[slot] = queue
        if (entry) {
          const active = stageFxActiveStackRef.current[slot] ?? []
          stageFxActiveStackRef.current[slot] = [...active, entry]
          const nickname = resolveSlotNickname(slot, slotSelectionsRef)
          const direction = entry.delta > 0 ? 'subida' : 'bajada'
          const label = STAT_LABELS[entry.stat]
          appendLogEntry(`${nickname} comienza ${direction} de ${label} ${formatStage(entry.delta)}`)
        }
      }

      const handleStageFxComplete = ({ slot }: { slot: PokemonSlot }) => {
        stageFxCounterRef.current[slot] = Math.max(0, (stageFxCounterRef.current[slot] ?? 1) - 1)
        const stack = stageFxActiveStackRef.current[slot] ?? []
        const entry = stack.shift() ?? null
        stageFxActiveStackRef.current[slot] = stack
        if (entry) {
          const nickname = resolveSlotNickname(slot, slotSelectionsRef)
          const direction = entry.delta > 0 ? 'subida' : 'bajada'
          const label = STAT_LABELS[entry.stat]
          appendLogEntry(`${nickname} finaliza ${direction} de ${label} ${formatStage(entry.delta)}`)
        }
      }

      game.events.on('pokemon:animations', handleAnimations)
      game.events.on('battle:sim:roster', handleSimRoster)
      game.events.on('battle:sim:request', handleSimRequest)
      game.events.on('battle:sim:started', handleSimStarted)
      game.events.on('scene:debugState', handleDebugState)
      game.events.on('pokemon:actionComplete', handleActionComplete)
      game.events.on('pokemon:actionStart', handleActionStart)
      game.events.on('pokemon:slotEmpty', handleSlotEmpty)
      game.events.on('pokemon:hpDelta', handleHpDeltaEvent)
      game.events.on('battle:weatherComplete', handleWeatherComplete)
      game.events.on('pokemon:stageFxStart', handleStageFxStart)
      game.events.on('pokemon:stageFxComplete', handleStageFxComplete)

      unsubscribe = () => {
        game.events.off('pokemon:animations', handleAnimations)
        game.events.off('scene:debugState', handleDebugState)
        game.events.off('pokemon:actionComplete', handleActionComplete)
        game.events.off('pokemon:actionStart', handleActionStart)
        game.events.off('pokemon:hpDelta', handleHpDeltaEvent)
        game.events.off('battle:weatherComplete', handleWeatherComplete)
        game.events.off('pokemon:stageFxStart', handleStageFxStart)
        game.events.off('pokemon:stageFxComplete', handleStageFxComplete)
        game.events.off('pokemon:slotEmpty', handleSlotEmpty)
        game.events.off('battle:sim:roster', handleSimRoster)
        game.events.off('battle:sim:request', handleSimRequest)
        game.events.off('battle:sim:started', handleSimStarted)
      }
    })

    return () => {
      disposed = true
      unsubscribe?.()
      setAnimationPanels([])
      setSceneDebugState(undefined)
      const game = gameRef.current
      if (game) {
        game.destroy(true)
        gameRef.current = null
      }
      if (container) {
        const threeCanvas = document.getElementById('enable3d-three-canvas')
        if (threeCanvas && container.contains(threeCanvas)) {
          threeCanvas.remove()
        }
      }
    }
  }, [])



  const requestAnimation = (

    actorId: string,

    name: string,

    options?: PlayAnimationOptions

  ) => {

    const label = options?.actionLabel ? ` (${options.actionLabel})` : ''

    console.log(`[Animation] ${actorId} -> ${name}${label}`)

    gameRef.current?.events.emit('pokemon:play', {

      id: actorId,

      name,

      actionId: options?.actionId,

      actionLabel: options?.actionLabel,

      initiatorId: actorId,

    })

  }



  const triggerCameraBehavior = (request: CameraBehaviorRequest) => {

    //console.log('[PhaserCanvas] emitting camera behavior', request.id, request.initiatorId)

    gameRef.current?.events.emit('camera:behavior', request)

  }



  const animateHealthBar = useCallback(

    (slot: PokemonSlot, targetValue: number, duration: number = DEFAULT_HP_ANIMATION_DURATION) => {

      const snapshot = slotHealthRef.current[slot]

      if (!snapshot) return

      const clampedTarget = clampHpValue(targetValue, snapshot.max)

      if (Math.abs(clampedTarget - snapshot.current) < 1e-2) return

      const cancelExisting = () => {

        const rafId = healthAnimationRef.current[slot]

        if (rafId !== null) {

          window.cancelAnimationFrame(rafId)

          healthAnimationRef.current[slot] = null

        }

      }

      if (duration <= 0) {

        cancelExisting()

        setSlotHealth((current) => {

          const slotEntry = current[slot]

          if (!slotEntry) return current

          if (Math.abs(slotEntry.current - clampedTarget) < 1e-2) return current

          return { ...current, [slot]: { ...slotEntry, current: clampedTarget } }

        })

        return

      }

      cancelExisting()

      const startValue = snapshot.current

      const startTime = performance.now()

      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

      const step = (timestamp: number) => {

        const progress = Math.min(1, (timestamp - startTime) / duration)

        const eased = ease(progress)

        const frameValue = startValue + (clampedTarget - startValue) * eased

        setSlotHealth((current) => {

          const slotEntry = current[slot]

          if (!slotEntry) return current

          return {

            ...current,

            [slot]: {

              ...slotEntry,

              current: progress >= 1 ? clampedTarget : frameValue,

            },

          }

        })

        if (progress < 1) {

          healthAnimationRef.current[slot] = window.requestAnimationFrame(step)

        } else {

          healthAnimationRef.current[slot] = null

        }

      }

      healthAnimationRef.current[slot] = window.requestAnimationFrame(step)

    },

    []

  )



  const pushDamageState = useCallback((slot: PokemonSlot) => {

    if (damageStateTimerRef.current[slot]) {

      window.clearTimeout(damageStateTimerRef.current[slot]!)

      damageStateTimerRef.current[slot] = null

    }

    let applied = false

    setBattleStates((current) => {

      const previous = current[slot]

      if (previous === 'debilitado') {

        damageStateRestoreRef.current[slot] = null

        return current

      }

      if (previous !== 'takingDamage') {

        damageStateRestoreRef.current[slot] = previous

        applied = true

        const next = { ...current, [slot]: 'takingDamage' }

        battleStatesRef.current = next

        return next

      }

      applied = true

      return current

    })

    if (!applied) return

    damageStateTimerRef.current[slot] = window.setTimeout(() => {

      setBattleStates((current) => {

        if (current[slot] !== 'takingDamage') return current

        const previous = damageStateRestoreRef.current[slot] ?? null

        damageStateRestoreRef.current[slot] = null

        const next = { ...current, [slot]: previous }

        battleStatesRef.current = next

        return next

      })

      damageStateTimerRef.current[slot] = null

    }, DAMAGE_STATE_DURATION_MS)

  }, [])



  const triggerDamageReaction = useCallback(

    (slot: PokemonSlot, label?: string) => {

      if (!slotSpeciesStateRef.current[slot]) return

      pushDamageState(slot)

      requestAnimation(slot, 'damage01.tranm', {

        actionId: `damage:${slot}:${Date.now()}`,

        actionLabel: label ?? 'Damage',

      })

    },

    [pushDamageState]

  )



  const applyHpDelta = useCallback(

    (

      slot: PokemonSlot,

      delta: number,

      options?: { label?: string; skipDamageAnimation?: boolean; durationMs?: number }

    ) => {

      const activeInstance = findInstanceByUid(gameState, slot, gameState.active[slot])

      if (!activeInstance) return

      const currentValue = activeInstance.currentHp

      const maxValue = activeInstance.maxHp

      if (maxValue <= 0) return

      const nextValue = clampHpValue(currentValue + delta, maxValue)

      if (Math.abs(nextValue - currentValue) < 1e-2) return



      setGameState((current) => {

        const activeUid = current.active[slot]

        if (!activeUid) return current

        const team = current.teams[slot] ?? []

        const idx = team.findIndex((entry) => entry.uid === activeUid)

        if (idx < 0) return current

        const instance = team[idx]

        const updated = { ...instance, currentHp: nextValue }

        const nextTeam = [...team]

        nextTeam[idx] = updated

        return { ...current, teams: { ...current.teams, [slot]: nextTeam } }

      })



      animateHealthBar(

        slot,

        nextValue,

        options?.durationMs ?? DEFAULT_HP_ANIMATION_DURATION

      )

      const actualDelta = nextValue - currentValue

      const isDamage = actualDelta < 0

      /*      if (isDamage && !options?.skipDamageAnimation) {
     
             triggerDamageReaction(slot, options?.label)
     
           } */

      const speciesId = activeInstance.species

      const nickname =
        activeInstance.nickname ||
        slotSelectionsRef.current[slot]?.nickname ||
        speciesId ||
        slot.toUpperCase()

      appendLogEntry(

        `${nickname} ${isDamage ? 'pierde' : 'recupera'} ${Math.abs(Math.round(actualDelta))} PS (${Math.round(

          nextValue

        )}/${Math.round(maxValue)})${options?.label ? ` - ${options.label}` : ''}`

      )

    },

    [animateHealthBar, appendLogEntry, gameState, triggerDamageReaction]

  )



  const applyHpDeltaRef = useRef(applyHpDelta)

  applyHpDeltaRef.current = applyHpDelta



  const parseStatIdFromString = (value: string): StatId | null => {

    const normalized = value.toLowerCase()

    if ((Object.keys(STAT_LABELS) as StatId[]).includes(normalized as StatId)) {

      return normalized as StatId

    }

    const map: Record<string, StatId> = {

      spa: 'spa',

      spdef: 'spd',

      spd: 'spd',

      spdefense: 'spd',

      spattack: 'spa',

      specialattack: 'spa',

      specialdefense: 'spd',

      speed: 'spe',

      atk: 'atk',

      attack: 'atk',

      def: 'def',

      defense: 'def',

    }

    return map[normalized] ?? null

  }



  const parseDamageCommand = (command: string) => {

    if (!command?.includes('-damage')) return null

    const parts = command.split('|').filter(Boolean)

    const action = parts[0]

    if (action !== '-damage') return null

    const target = parts[1]

    const hpSpec = parts[2]

    if (!target || !hpSpec) return null

    const slotMatch = target.match(/p([12])/i)

    if (!slotMatch) return null

    const slot = slotMatch[1] === '1' ? 'p1' : ('p2' as PokemonSlot)

    if (hpSpec.includes('/')) {

      const [currentStr, maxStr] = hpSpec.split('/')

      const current = Number(currentStr)

      const max = Number(maxStr)

      if (!Number.isFinite(current) || !Number.isFinite(max)) return null

      return { slot, current, max, faint: current <= 0 || hpSpec.toLowerCase().includes('fnt') }

    }

    const matchNumber = hpSpec.match(/-?\d+/)

    if (!matchNumber) return null

    const current = Number(matchNumber[0])

    if (!Number.isFinite(current)) return null

    return { slot, current, faint: current <= 0 || hpSpec.toLowerCase().includes('fnt') }

  }



  const parseStageCommand = (command: string) => {

    if (!command?.includes('-unboost') && !command?.includes('-boost')) return null

    const parts = command.split('|').filter(Boolean)

    const action = parts[0]

    if (action !== '-unboost' && action !== '-boost') return null

    const target = parts[1]

    const statIdRaw = parts[2]

    const amountRaw = parts[3]

    if (!target || !statIdRaw || amountRaw === undefined) return null

    const slot = resolveSlotFromDescriptor(target)

    const stat = parseStatIdFromString(statIdRaw)

    if (!stat) return null

    const amount = Number(amountRaw)

    if (!Number.isFinite(amount)) return null

    const pokemonName = extractNameFromDescriptor(target) || target

    return { slot, stat, delta: amount, pokemonName }

  }



  const resolveSlotForCommand = (command: string): PokemonSlot | null => {

    const parts = command.split('|').filter(Boolean)

    const action = parts[0]

    if (action === 'move') {

      return resolveSlotFromDescriptor(parts[1])

    }

    if (action === '-damage') {

      const parsed = parseDamageCommand(command)

      return parsed?.slot ?? null

    }

    if (action === '-faint') {

      const parsed = parseFaintCommand(command)

      return parsed?.slot ?? null

    }

    if (action === '-unboost' || action === '-boost') {

      const parsed = parseStageCommand(command)

      return parsed?.slot ?? null

    }

    return null

  }



  const applyDamageCommand = (command: string, label?: string) => {

    const parsed = parseDamageCommand(command)

    if (!parsed) {

      appendLogEntry('No se pudo interpretar el comando de damage programado.')

      return

    }

    const { slot, current, faint } = parsed

    const snapshot = slotHealthRef.current[slot]

    const baseline = snapshot?.current ?? findInstanceByUid(gameState, slot, gameState.active[slot])?.currentHp

    if (baseline === undefined || baseline === null) {

      appendLogEntry('No se pudo resolver el estado de vida para aplicar damage.')

      return

    }

    const delta = current - baseline

    applyHpDeltaRef.current(slot, delta, {

      label: label ?? 'Damage programado',

      durationMs: 500,

    })

    if (faint || current <= 0) {

      handleFaintState(slot, { label, respawnAfter: false })

    }

  }



  const parseFaintCommand = (command: string) => {

    if (!command?.includes('-faint')) return null

    const parts = command.split('|').filter(Boolean)

    if (parts[0] !== '-faint') return null

    const target = parts[1]

    const slotMatch = target?.match(/p([12])/i)

    if (!slotMatch) return null

    const slot = slotMatch[1] === '1' ? 'p1' : ('p2' as PokemonSlot)

    return { slot }

  }



  const applyFaintCommand = (command: string) => {

    const parsed = parseFaintCommand(command)

    if (!parsed) {

      appendLogEntry('No se pudo interpretar el comando de debilitamiento.')

      return

    }

    const { slot } = parsed

    const snapshot = slotHealthRef.current[slot]

    const baseline =

      snapshot?.current ?? findInstanceByUid(gameState, slot, gameState.active[slot])?.currentHp

    if (baseline === undefined || baseline === null) {

      appendLogEntry('No se pudo resolver el estado de vida para debilitar.')

      return

    }

    if (baseline > 0) {

      applyHpDeltaRef.current(slot, -baseline, {

        label: 'Debilitamiento',

        durationMs: 450,

      })

    }

    handleFaintState(slot, { label: 'Debilitamiento', respawnAfter: false })

  }



  const triggerSwapPokemon = (

    slot: PokemonSlot,

    selection: PokemonSelection,

    visuals?: SwapVisualOptions

  ) => {

    const currentActive = activeInstances[slot]

    const isSameSelection =

      currentActive &&

      ((selection.selectionId && selection.selectionId === currentActive.selectionId) ||

        (!selection.selectionId &&

          currentActive.selectionId === undefined &&

          currentActive.species === selection.id &&

          currentActive.isRare === selection.isRare))

    if (isSameSelection) return



    if (visuals?.camera || visuals?.midActions || visuals?.resetCameraAfter) {

      const swapActionId = `swap:${slot}:${Date.now()}`

      const afterActions: CameraBehaviorAction[] = visuals.resetCameraAfter

        ? [{ type: 'resetCamera' }]

        : []

      triggerCameraBehavior({

        id: swapActionId,

        initiatorId: slot,

        label: 'Cambio de Pokemon',

        camera:

          visuals.camera ??

          ({

            position: { x: 'current', y: 'current', z: 'current' },

            lookAt: { type: 'actor', id: slot },

            duration: 0.35,

          } satisfies CameraBehaviorRequest['camera']),

        afterCameraActions: afterActions.length ? afterActions : undefined,

      })

    }



    const skipImplode = battleStates[slot] === 'debilitado'

    setGameState((current) => {

      const team = current.teams[slot] ?? []

      const options = backendTeamsRef.current[slot] ?? []

      const selectionIndex = options.indexOf(selection)

      const candidate =

        (selectionIndex >= 0 ? team[selectionIndex] : undefined) ??

        team.find(

          (inst) =>

            (selection.selectionId && inst.selectionId === selection.selectionId) ||

            (inst.species === selection.id && inst.isRare === selection.isRare)

        ) ??

        team[0] ??

        null

      const nextActiveUid = candidate?.uid ?? null

      return {

        ...current,

        active: { ...current.active, [slot]: nextActiveUid },

      }

    })

    gameRef.current?.events.emit('pokemon:swap', {

      slot,

      species: selection.id,

      selectionId: selection.selectionId,

      isRare: selection.isRare,

      skipImplode,

    })

    setBattleStates((current) => {

      const next = { ...current, [slot]: 'swap' }

      battleStatesRef.current = next

      return next

    })

    setSlotSelections((current) => ({ ...current, [slot]: selection }))

    setSlotSpecies((current) => ({ ...current, [slot]: selection.id }))

    const nickname = selection.nickname ?? selection.id

    appendLogEntry(

      `Swap ${slot.toUpperCase()} -> ${nickname}${skipImplode ? ' (sin implosion)' : ''}`

    )

  }



  const triggerWhiteout = (

    slot: PokemonSlot,

    options?: { respawnAfter?: boolean; withParticles?: boolean }

  ) => {

    const respawnAfter = options?.respawnAfter ?? true

    const withParticles = options?.withParticles ?? false

    gameRef.current?.events.emit('pokemon:whiteout', { slot, respawnAfter, withParticles })

    if (!respawnAfter) {

      setBattleStates((current) => {

        const next = { ...current, [slot]: 'debilitado' }

        battleStatesRef.current = next

        return next

      })

      setSlotSpecies((current) => ({ ...current, [slot]: null }))

      setSlotSelections((current) => ({ ...current, [slot]: null }))

      appendLogEntry(

        `El slot ${slot.toUpperCase()} ha quedado vacio. Selecciona un nuevo Pokemon para continuar.`

      )

    }

  }



  const handleHpDeltaRequest = (

    slot: PokemonSlot,

    delta: number,

    options?: { label?: string; skipDamageAnimation?: boolean; durationMs?: number }

  ) => {

    if (!gameRef.current) return

    gameRef.current.events.emit('pokemon:hpDelta', {

      slot,

      delta,

      label: options?.label,

      skipDamageAnimation: options?.skipDamageAnimation,

      durationMs: options?.durationMs,

    })

  }



  const handleTriggerWeather = useCallback(

    (payload: WeatherTriggerRequest) => {

      if (!gameRef.current) return

      const action = payload.action ?? 'start'

      if (action === 'stop') {

        if (!weatherActive) return

        const targetType = payload.type ?? activeWeatherType

        if (!targetType) return

        const label = payload.label ?? getWeatherLabel(targetType)

        gameRef.current.events.emit('battle:weather', {

          type: targetType,

          action: 'stop',

          label,

        })

        return

      }

      if (weatherActive) return

      const weatherType = payload.type ?? 'rain'

      const label = payload.label ?? getWeatherLabel(weatherType)

      setWeatherActive(true)

      setActiveWeatherType(weatherType)

      gameRef.current.events.emit('battle:weather', {

        type: weatherType,

        durationMs: payload.durationMs,

        label,

        action: 'start',

      })

    },

    [activeWeatherType, weatherActive]

  )



  const handleToggleFullscreen = () => {

    const shell = shellRef.current

    if (!shell) return

    if (document.fullscreenElement === shell) {

      void document.exitFullscreen?.()

    } else {

      void shell.requestFullscreen?.()

    }

  }



  const handleResolutionChange = (event: ChangeEvent<HTMLSelectElement>) => {

    const value = event.target.value as ResolutionId

    setResolution(value)

  }



  const handleAdjustStage = (slot: PokemonSlot, statId: StatId, delta: number) => {

    if (delta === 0) return

    const currentValue =

      findInstanceByUid(gameState, slot, gameState.active[slot])?.boosts?.[statId] ?? 0

    const nextValue = clampStage(currentValue + delta)

    if (nextValue === currentValue) return

    const actualDelta = nextValue - currentValue

    stageFxQueueRef.current[slot] = stageFxQueueRef.current[slot] ?? []

    stageFxQueueRef.current[slot].push({ stat: statId, delta: actualDelta })

    setGameState((current) => {

      const activeUid = current.active[slot]

      if (!activeUid) return current

      const team = current.teams[slot] ?? []

      const idx = team.findIndex((entry) => entry.uid === activeUid)

      if (idx < 0) return current

      const existing = team[idx]

      const updated = {

        ...existing,

        boosts: { ...existing.boosts, [statId]: nextValue },

      }

      const nextTeam = [...team]

      nextTeam[idx] = updated

      return { ...current, teams: { ...current.teams, [slot]: nextTeam } }

    })

    setSlotStages((current) => ({

      ...current,

      [slot]: {

        ...current[slot],

        [statId]: nextValue,

      },

    }))

    const type = delta > 0 ? 'buff' : 'debuff'

    gameRef.current?.events.emit('pokemon:stageChange', { slot, type })

    const label = STAT_LABELS[statId]

    appendLogEntry(

      `${slot.toUpperCase()} ${actualDelta > 0 ? 'sube' : 'baja'} ${label} a ${formatStage(nextValue)}`

    )

  }



  const isExecutingMove = (slot: PokemonSlot) => {

    const state = battleStatesRef.current?.[slot] ?? battleStates[slot]

    return (

      state === 'contactAttack' ||

      state === 'rangedAttack' ||

      state === 'statusAttack' ||

      state === 'swap'

    )

  }



  const resolveAnimationTypeForMoveName = (moveName: string): 'contact' | 'ranged' | 'status' => {

    const found = findMoveByDisplayName(moveName)

    if (!found) return 'contact'

    const [, move] = found

    if (move.category === 'Status') return 'status'

    if (move.category === 'Physical' || move.category === 'Special') {

      const hasContactFlag = Boolean(

        (move.flags as Record<string, number | boolean> | undefined)?.contact

      )

      return hasContactFlag ? 'contact' : 'ranged'

    }

    return 'contact'

  }



  const RANGED_CAMERA_CONFIG: Record<

    PokemonSlot,

    { position: { x: number; y: number; z: number }; duration: number }

  > = {

    p1: { position: { x: -1.15, y: 0.92, z: 2.6 }, duration: 0.65 },

    p2: { position: { x: 1.15, y: 0.92, z: -2.6 }, duration: 0.65 },

  }



  const runContactAttack = (

    slot: PokemonSlot,

    moveName: string,

    visuals?: AttackVisualOptions

  ) => {

    const enemy: PokemonSlot = slot === 'p1' ? 'p2' : 'p1'

    const variantsForP1 = [

      { id: 'contact-attack-p1:attack01', animation: '_attack01.tranm' },

      { id: 'contact-attack-p1:attack02', animation: '_attack02.tranm' },

    ] as const

    const variantsForP2 = [

      { id: 'contact-attack-p2:attack01', animation: '_attack01.tranm' },

      { id: 'contact-attack-p2:attack02', animation: '_attack02.tranm' },

    ] as const

    const variant =

      slot === 'p1'

        ? selectAnimationVariantForSlot(variantsForP1, slot)

        : selectAnimationVariantForSlot(variantsForP2, slot)

    const attackerAnimation = visuals?.attackerAnimation ?? variant.animation

    const enemyReactionAnimation = visuals?.enemyReactionAnimation ?? 'damage01.tranm'

    const resetCameraAfter = visuals?.resetCameraAfter ?? true

    const defaultMidActions: AttackMidAction[] = [

      {

        at: 0.33,

        actions: [

          { type: 'shakeCamera', duration: 260, intensity: 0.04 },

          { type: 'freezeActors', ids: [slot], duration: 200 },

        ],

      },

      {

        at: 0.33,

        actions: [

          {

            type: 'playAnimation',

            id: enemy,

            animation: enemyReactionAnimation,

            onComplete: [{ type: 'playIdleRandom', id: enemy }],

          },

        ],

      },

      {

        at: 0.6,

        actions: [

          { type: 'resetActorPosition', id: slot, duration: 50 },

          ...(resetCameraAfter ? ([{ type: 'resetCamera' } as CameraBehaviorAction]) : []),

        ],

      },

    ]

    const midActions = visuals?.midActions ?? defaultMidActions

    const camera =

      visuals?.camera ??

      ({

        position: { x: 'current', y: 'current', z: 'current' },

        lookAt: { type: 'actor', id: enemy },

        duration: 0.5,

      } satisfies CameraBehaviorRequest['camera'])

    handleSetBattleState(slot, 'contactAttack')

    triggerCameraBehavior({

      id: variant.id,

      label: moveName,

      initiatorId: slot,

      camera,

      afterCameraActions: [

        {

          type: 'playAnimation',

          id: slot,

          animation: attackerAnimation,

          midActions,

          onComplete: [{ type: 'playIdleRandom', id: slot }],

        },

      ],

    })

    handleLogEvent(`${slot.toUpperCase()} usa ${moveName} (contact)`)

  }



  const runRangedAttack = (

    slot: PokemonSlot,

    moveName: string,

    visuals?: AttackVisualOptions

  ) => {

    handleSetBattleState(slot, 'rangedAttack')

    const variants = [

      { id: 'ranged-attack:rangeattack01', animation: 'rangeattack01.tranm' },

      { id: 'ranged-attack:rangeattack02', animation: 'rangeattack02_start.tranm' },

      { id: 'ranged-attack:directionattack01', animation: 'directionattack01.tranm' },

    ] as const

    const variant = selectAnimationVariantForSlot(variants, slot)

    const attackerAnimation = visuals?.attackerAnimation ?? variant.animation

    const enemy: PokemonSlot = slot === 'p1' ? 'p2' : 'p1'

    const cameraConfig = RANGED_CAMERA_CONFIG[slot]

    const actionId = `${variant.id}:${slot}:${Date.now()}`

    const enemyReactionAnimation = visuals?.enemyReactionAnimation ?? 'damage02.tranm'

    const resetCameraAfter = visuals?.resetCameraAfter ?? true

    const midActions =

      visuals?.midActions ??

      ([

        {

          at: 0.52,

          actions: [

            {

              type: 'playAnimation',

              id: enemy,

              animation: enemyReactionAnimation,

              onComplete: [{ type: 'playIdleRandom', id: enemy }],

            },

            { type: 'shakeCamera', duration: 220, intensity: 0.025 },

          ],

        },

      ] satisfies AttackMidAction[])

    const camera =

      visuals?.camera ??

      ({

        position: cameraConfig.position,

        lookAt: { type: 'actor', id: enemy },

        duration: cameraConfig.duration,

      } satisfies CameraBehaviorRequest['camera'])

    const onComplete: CameraBehaviorAction[] = [{ type: 'playIdleRandom', id: slot }]

    if (resetCameraAfter) onComplete.push({ type: 'resetCamera' })

    triggerCameraBehavior({

      id: actionId,

      label: moveName,

      initiatorId: slot,

      camera,

      afterCameraActions: [

        {

          type: 'playAnimation',

          id: slot,

          animation: attackerAnimation,

          midActions,

          onComplete,

        },

      ],

    })

    handleLogEvent(`${slot.toUpperCase()} usa ${moveName} (ranged)`)

  }



  const runStatusAttack = (

    slot: PokemonSlot,

    moveName: string,

    selfTarget: boolean,

    visuals?: AttackVisualOptions

  ) => {

    handleSetBattleState(slot, 'statusAttack')

    if (selfTarget) {

      if (visuals?.camera) {

        triggerCameraBehavior({

          id: `status-self:${slot}:${Date.now()}`,

          initiatorId: slot,

          label: moveName,

          camera: visuals.camera,

        })

      } else {

        const cameraRequest = buildSelfStatusCameraRequest(slot, moveName)

        triggerCameraBehavior(cameraRequest)

      }

    } else {

      const variants = [

        { animation: 'attack01.tranm' },

        { animation: 'attack02.tranm' },

      ] as const

      const variant = selectAnimationVariantForSlot(variants, slot)

      const attackerAnimation = visuals?.attackerAnimation ?? variant.animation

      requestAnimation(slot, attackerAnimation, {

        actionId: `status:${slot}:${Date.now()}`,

        actionLabel: moveName,

      })

    }

    handleLogEvent(`${slot.toUpperCase()} usa ${moveName} (status)`)

  }



  // Centro +¦nico para orquestar las acciones de batalla (ataques, debilitar, swap, etc.)

  type BattleAction =

    | { type: 'contact'; slot: PokemonSlot; moveName: string; visuals?: AttackVisualOptions }

    | { type: 'ranged'; slot: PokemonSlot; moveName: string; visuals?: AttackVisualOptions }

    | {

      type: 'status'

      slot: PokemonSlot

      moveName: string

      selfTarget: boolean

      visuals?: AttackVisualOptions

    }

    | {

      type: 'faint'

      slot: PokemonSlot

      label?: string

      respawnAfter?: boolean

      visuals?: FaintVisualOptions

    }

    | { type: 'swap'; slot: PokemonSlot; selection: PokemonSelection; visuals?: SwapVisualOptions }



  const handleFaintState = (

    slot: PokemonSlot,

    options?: { label?: string; respawnAfter?: boolean; visuals?: FaintVisualOptions }

  ) => {

    const actionId = `faint:${slot}:${Date.now()}`

    const actionLabel = 'Debilitamiento'

    const defaultCamera: CameraBehaviorRequest['camera'] = {

      position: {

        x: { type: 'relative', delta: slot === 'p1' ? -0.35 : 0.35 },

        y: { type: 'relative', delta: 0.35 },

        z: { type: 'relative', delta: slot === 'p1' ? -1.2 : 1.2 },

      },

      lookAt: { type: 'actor', id: slot },

      duration: 0,

    }

    const camera = options?.visuals?.camera ?? defaultCamera

    const playFaintAnimation = () =>

      requestAnimation(slot, 'down01_start.tranm', {

        actionId,

        actionLabel,

      })

    const hasCamera = Boolean(gameRef.current)

    if (hasCamera) {

      const cameraBehaviorId = `${actionId}:camera`

      triggerCameraBehavior({

        id: cameraBehaviorId,

        initiatorId: slot,

        label: actionLabel,

        camera,

      })

      const game = gameRef.current

      if (game) {

        const playAfterCamera = () => playFaintAnimation()

        const fallbackDelayMs =

          typeof camera.duration === 'number' && Number.isFinite(camera.duration)

            ? camera.duration * 1000 + 200

            : 650

        const timeoutId = window.setTimeout(() => {

          cleanup()

          playAfterCamera()

        }, fallbackDelayMs)

        const handler = ({ id }: { id?: string }) => {

          if (id !== cameraBehaviorId) return

          cleanup()

          playAfterCamera()

        }

        const cleanup = () => {

          game.events.off('pokemon:actionComplete', handler)

          window.clearTimeout(timeoutId)

        }

        game.events.on('pokemon:actionComplete', handler)

        return

      }

    }



    playFaintAnimation()



    setBattleStates((currentState) => {

      const next = { ...currentState, [slot]: 'debilitado' }

      battleStatesRef.current = next

      return next

    })

    const nickname =

      findInstanceByUid(gameState, slot, gameState.active[slot])?.nickname ?? slot.toUpperCase()

    setBattleFeed((current) => [...current, `-í${nickname} se debilit+¦!`].slice(-3))

    // El whiteout ahora lo agenda la escena usando la duracion real del clip.

    const logLabel = options?.label ?? actionLabel

    appendLogEntry(`${nickname} - ${logLabel}`)

  }



  const performBattleAction = (action: BattleAction) => {

    switch (action.type) {

      case 'contact':

        runContactAttack(action.slot, action.moveName, action.visuals)

        return

      case 'ranged':

        runRangedAttack(action.slot, action.moveName, action.visuals)

        return

      case 'status':

        runStatusAttack(action.slot, action.moveName, action.selfTarget, action.visuals)

        return

      case 'faint':

        handleFaintState(action.slot, {

          label: action.label,

          respawnAfter: action.respawnAfter,

          visuals: action.visuals,

        })

        return

      case 'swap':

        triggerSwapPokemon(action.slot, action.selection, action.visuals)

        return

      default:

        return

    }

  }



  const clearScheduledListeners = () => {

    if (!scheduledCleanupRef.current.length) return

    scheduledCleanupRef.current.forEach((cleanup) => cleanup())

    scheduledCleanupRef.current = []

  }



  const waitForSlotActionComplete = (slot: PokemonSlot) =>

    new Promise<void>((resolve) => {

      const game = gameRef.current

      if (!game) {

        console.log('[CommandQueue] no game; resolve actionComplete wait for', slot)

        resolve()

        return

      }

      const gameEvents = game.events

      console.log('[CommandQueue] waiting actionComplete for', slot)

      const timeoutId = window.setTimeout(() => {

        cleanup()

        console.log('[CommandQueue] timeout actionComplete for', slot)

        resolve()

      }, 4000)

      const checkIdleAndResolve = () => {

        if (isExecutingMove(slot)) return

        cleanup()

        console.log('[CommandQueue] actionComplete + idle for', slot)

        resolve()

      }

      function handler({ initiatorId }: { initiatorId?: string }) {

        if (initiatorId !== slot) return

        // wait a tick to allow state updates

        window.setTimeout(checkIdleAndResolve, 0)

      }

      function cleanup() {

        gameEvents.off('pokemon:actionComplete', handler)

        scheduledCleanupRef.current = scheduledCleanupRef.current.filter((fn) => fn !== cleanup)

        window.clearTimeout(timeoutId)

      }

      scheduledCleanupRef.current.push(cleanup)

      gameEvents.on('pokemon:actionComplete', handler)

    })



  const waitForStageFxComplete = (slot: PokemonSlot) =>

    new Promise<void>((resolve) => {

      const game = gameRef.current

      if (!game) {

        resolve()

        return

      }

      const gameEvents = game.events

      const timeoutId = window.setTimeout(() => {

        cleanup()

        resolve()

      }, 3000)

      const handler = ({ slot: eventSlot }: { slot: PokemonSlot }) => {

        if (eventSlot !== slot) return

        cleanup()

        resolve()

      }

      const cleanup = () => {

        gameEvents.off('pokemon:stageFxComplete', handler)

        scheduledCleanupRef.current = scheduledCleanupRef.current.filter((fn) => fn !== cleanup)

        window.clearTimeout(timeoutId)

      }

      scheduledCleanupRef.current.push(cleanup)

      gameEvents.on('pokemon:stageFxComplete', handler)

    })



  const waitDelay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))



  const waitForSlotReady = async (slot: PokemonSlot | null) => {

    if (!slot) return

    while (isExecutingMove(slot) || (stageFxCounterRef.current[slot] ?? 0) > 0) {

      const waits: Promise<void>[] = []

      if (isExecutingMove(slot)) waits.push(waitForSlotActionComplete(slot))

      if ((stageFxCounterRef.current[slot] ?? 0) > 0) waits.push(waitForStageFxComplete(slot))

      await Promise.all(waits)

    }

  }



  const waitForCommandCompletion = async (action: string, slot: PokemonSlot | null) => {

    if (!slot) {

      await waitDelay(150)

      return

    }

    if (action === 'move') {

      await waitForSlotActionComplete(slot)

      return

    }

    if (action === '-boost' || action === '-unboost') {

      await waitForStageFxComplete(slot)

      return

    }

    if (action === '-damage' || action === '-faint') {

      await waitDelay(500)

      return

    }

    await waitDelay(150)

  }



  const playScheduledSequence = async () => {

    if (isScheduledPlaying) return

    const slotEmpty = ALL_POKEMON_SLOTS.some((entry) => slotSpecies[entry] === null)

    const moveInProgress = ALL_POKEMON_SLOTS.some((entry) => isExecutingMove(entry))

    if (slotEmpty || moveInProgress) {

      appendLogEntry('No se puede iniciar la secuencia programada (slots vacios o acciones en curso).')

      return

    }

    scheduledAbortRef.current = false

    clearScheduledListeners()

    setIsScheduledPlaying(true)

    appendLogEntry('Secuencia programada: P1 Sword Dance -> P2 Play Rough (KO)')

    try {

      const waitP1 = waitForSlotActionComplete('p1')

      performBattleAction({ type: 'status', slot: 'p1', moveName: 'Sword Dance', selfTarget: true })

      await waitP1

      if (scheduledAbortRef.current) return

      handleAdjustStage('p1', 'atk', 1)

      handleAdjustStage('p1', 'spe', 2)



      const waitP2 = waitForSlotActionComplete('p2')

      performBattleAction({ type: 'contact', slot: 'p2', moveName: 'Play Rough' })

      await waitP2

      if (scheduledAbortRef.current) return



      setBattleFeed((current) => [...current, '-íEs supereficaz!'].slice(-3))

      applyDamageCommand('|-damage|p1a: Meowscarada|0 fnt', 'KO en cola')

      if (!scheduledAbortRef.current) appendLogEntry('Secuencia programada finalizada')

    } catch (error) {

      console.error('[PhaserCanvas] Error al ejecutar secuencia programada', error)

      appendLogEntry('Error al ejecutar la secuencia programada')

    } finally {

      clearScheduledListeners()

      setIsScheduledPlaying(false)

    }

  }



  const handleBattleProtocolCommand = (command: string) => {

    if (!command) {

      appendLogEntry('Comando vacio.')

      return

    }

    const parts = command.split('|').filter(Boolean)

    const action = parts[0]

    if (action === 'move') {

      const attackerPart = parts[1] ?? ''

      const moveName = (parts[2] ?? '').trim()

      const targetPart = parts[3] ?? ''

      if (!moveName) {

        appendLogEntry('Comando de movimiento sin nombre de move.')

        return

      }

      const attackerName = extractNameFromDescriptor(attackerPart) || attackerPart || 'Pokemon'

      const attackerSlot = resolveSlotFromDescriptor(attackerPart)

      const targetSlot = resolveSlotFromDescriptor(targetPart)

      const animationType = resolveAnimationTypeForMoveName(moveName)

      const moveTarget =

        animationType === 'status' || !targetPart ? 'self' : targetSlot === attackerSlot ? 'self' : undefined

      handleAttackCommand({

        slot: attackerSlot,

        moveName,

        animationType,

        moveTarget,

      })

      setBattleFeed((current) => [...current, `-í${attackerName} us+¦ ${moveName}!`].slice(-3))

      return

    }



    if (action === '-damage') {

      applyDamageCommand(command, 'Damage comando')

      return

    }



    if (action === '-faint') {

      applyFaintCommand(command)

      return

    }



    if (action === '-unboost' || action === '-boost') {

      const parsed = parseStageCommand(command)

      if (!parsed) {

        appendLogEntry('No se pudo interpretar el comando de stat change.')

        return

      }

      const currentStage = slotStagesRef.current?.[parsed.slot]?.[parsed.stat] ?? 0

      const desiredDelta = parsed.delta

      const nextStage = clampStage(currentStage + desiredDelta)

      const actualDelta = nextStage - currentStage

      if (actualDelta === 0) {

        appendLogEntry(`El stat ${STAT_LABELS[parsed.stat]} ya est+í en el l+¡mite.`)

        return

      }

      handleAdjustStage(parsed.slot, parsed.stat, actualDelta)

      const abs = Math.abs(actualDelta)

      const direction = actualDelta > 0 ? 'rose' : 'fell'

      const qualifier =

        abs >= 3 ? (direction === 'rose' ? ' drastically' : ' severely') : abs === 2 ? (direction === 'rose' ? ' sharply' : ' harshly') : ''

      const message = `${parsed.pokemonName}'s ${STAT_LABELS[parsed.stat]} ${direction}${qualifier}!`

      setBattleFeed((current) => [...current, message].slice(-3))

      appendLogEntry(message)

      return

    }



    if (action === '-supereffective') {

      setBattleFeed((current) => [...current, '-íEs supereficaz!'].slice(-3))

      return

    }



    appendLogEntry(`Comando no soportado: ${action ?? command}`)

  }



  const runCommandQueue = async (commands: string[]) => {

    if (isCommandRunning) return

    setIsCommandRunning(true)

    try {

      for (const raw of commands) {

        const command = raw.trim()

        if (!command) continue

        const parts = command.split('|').filter(Boolean)

        const action = parts[0]

        const slot = resolveSlotForCommand(command)

        if (slot) {

          await waitForSlotReady(slot)

        }

        handleBattleProtocolCommand(command)

        await waitForCommandCompletion(action, slot)

      }

    } finally {

      setIsCommandRunning(false)

    }

  }



  useEffect(() => {

    protocolCommandRef.current = handleBattleProtocolCommand

  }, [handleBattleProtocolCommand])



  useEffect(() => {

    ; (window as any).playBattleCommand = (cmd: string) => protocolCommandRef.current(cmd)

    return () => {

      delete (window as any).playBattleCommand

    }

  }, [])



  const handleAttackCommand = (payload: {

    slot: PokemonSlot

    moveName: string

    animationType: 'contact' | 'ranged' | 'status'

    moveTarget?: string

  }) => {

    const bridge = (window as any)?.showdownBridge

    if (!simSessionId || !bridge?.move) {

      handleLogEvent('No hay sesion del simulador activa para enviar el movimiento.')

      return

    }

    bridge

      .move(payload.moveName)

      ?.catch((err: unknown) =>

        appendLogEntry(`No se pudo enviar comando al simulador: ${String(err)}`)

      )

  }





  const availablePokemonIds = useMemo(

    () => animationPanels.map((panel) => panel.id),

    [animationPanels]

  )

  const knownAnimationsById = useMemo(() => {

    return animationPanels.reduce<Record<string, string[]>>((acc, panel) => {

      acc[panel.id] = panel.names

      return acc

    }, {})

  }, [animationPanels])



  const buildNameVariants = (value?: string | null) => {

    if (!value) return [] as string[]

    const lower = value.toLowerCase()

    const variants = new Set<string>([lower])

    if (lower.endsWith('.tranm')) {

      variants.add(lower.slice(0, -'.tranm'.length))

    }

    return Array.from(variants).filter(Boolean)

  }



  const clipMatchesAnimation = (clipName: string, target: string) => {

    if (!clipName || !target) return false

    const clipVariants = buildNameVariants(clipName)

    const targetVariants = buildNameVariants(target)

    if (!clipVariants.length || !targetVariants.length) return false

    if (clipVariants.some((value) => targetVariants.includes(value))) return true

    const underscoreTargets = targetVariants.map((variant) => `_${variant}`)

    if (clipVariants.some((value) => underscoreTargets.some((suffix) => value.endsWith(suffix)))) return true

    return clipVariants.some((value) => targetVariants.some((suffix) => value.endsWith(suffix)))

  }



  const selectAnimationVariantForSlot = <T extends { animation: string }>(

    variants: readonly T[],

    slot: PokemonSlot

  ): T => {

    if (!variants.length) {

      throw new Error('selectAnimationVariantForSlot requires at least one variant')

    }

    const known = knownAnimationsById[slot]

    if (known?.length) {

      const match = variants.find((variant) =>

        known.some((clip) => clipMatchesAnimation(clip, variant.animation))

      )

      if (match) return match

    }

    return variants[0]

  }



  type AttackMidAction = {

    at?: number

    delayMs?: number

    actions: CameraBehaviorAction[]

  }



  type VisualOptionsBase = {

    camera?: CameraBehaviorRequest['camera']

    midActions?: AttackMidAction[]

    resetCameraAfter?: boolean

  }



  type AttackVisualOptions = VisualOptionsBase & {

    attackerAnimation?: string

    enemyReactionAnimation?: string

  }



  type SwapVisualOptions = VisualOptionsBase

  type FaintVisualOptions = VisualOptionsBase



  const handleShakeCamera = (durationMs: number, intensity: number) => {

    triggerCameraBehavior({

      id: `camera-shake:${Date.now()}`,

      initiatorId: 'ui',

      camera: {

        position: { x: 'current', y: 'current', z: 'current' },

        lookAt: { type: 'point', position: { x: 'current', y: 'current', z: 'current' } },

        duration: 0,

      },

      afterCameraActions: [{ type: 'shakeCamera', duration: durationMs, intensity }],

    })

  }



  const emitCameraUpdate = (payload: { position?: Vector3Like; lookAt?: Vector3Like }) => {

    gameRef.current?.events.emit('scene:updateCamera', {

      ...payload,

      duration: 0,

    })

  }



  const handleUpdateCameraPosition = (next: Vector3Like) => {

    emitCameraUpdate({ position: next })

  }



  const handleUpdateCameraLookAt = (next: Vector3Like) => {

    emitCameraUpdate({ lookAt: next })

  }



  const handleUpdateActorPosition = (slot: PokemonSlot, position: Vector3Like) => {

    gameRef.current?.events.emit('scene:updateActorPosition', { id: slot, position })

  }



  const handleUpdateCameraFov = (nextFov: number) => {

    gameRef.current?.events.emit('scene:updateCameraFov', nextFov)

  }



  const handleRequestDebugState = () => {

    gameRef.current?.events.emit('scene:requestDebugState')

  }



  const containerStyle = isFullscreen

    ? undefined

    : { width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }

  const swapInProgress = ALL_POKEMON_SLOTS.some((slot) => battleStates[slot] === 'swap')

  const hasEmptySlot = ALL_POKEMON_SLOTS.some((slot) => slotSpecies[slot] === null)

  const moveInProgress = ALL_POKEMON_SLOTS.some((slot) => isExecutingMove(slot))

  const hasRoster = (backendTeams.p1?.length ?? 0) + (backendTeams.p2?.length ?? 0) > 0



  return (

    <div className={`game-shell${isFullscreen ? ' is-fullscreen' : ''}`} ref={shellRef}>

      <div

        className="game-shell__layout"

        style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}

      >

        <div

          className="command-editor"

          style={{

            minWidth: '260px',

            maxWidth: '320px',

            display: 'flex',

            flexDirection: 'column',

            gap: '8px',

          }}

        >

          <h3 style={{ margin: 0 }}>Simulador</h3>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

            <button type="button" onClick={startSimSession} disabled={!!simSessionId || isCommandRunning}>

              {simSessionId ? 'sesion activa' : 'Iniciar simulador'}

            </button>

            <button type="button" onClick={stopSimSession} disabled={!simSessionId}>

              Detener

            </button>

          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

            <input

              type="text"

              value={attachSessionIdInput}

              onChange={(e) => setAttachSessionIdInput(e.target.value)}

              placeholder="Session ID"

              style={{ flex: 1 }}

            />

            <button type="button" onClick={attachSimSession} disabled={!attachSessionIdInput}>

              Adjuntar

            </button>

          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

            <input

              type="text"

              value={teamOrder}

              onChange={(e) => setTeamOrder(e.target.value)}

              placeholder="Orden (ej: 123)"

              style={{ flex: 1 }}

            />

            <button type="button" onClick={sendTeamOrder} disabled={!simSessionId}>

              Enviar team

            </button>

          </div>

          <h4 style={{ margin: '6px 0 0' }}>Comandos manuales</h4>

          <textarea

            value={commandInput}

            onChange={(e) => setCommandInput(e.target.value)}

            rows={8}

            style={{ width: '100%', resize: 'vertical' }}

            placeholder="|-unboost|p1a: Cloyster|def|1"

          />

          <button

            type="button"

            onClick={() => runCommandQueue(commandInput.split('\n'))}

            disabled={isCommandRunning}

          >

            {isCommandRunning ? 'Ejecutando...' : 'Play comandos'}

          </button>

          <div className="action-log" style={{ maxHeight: '320px', overflowY: 'auto' }}>

            <div className="action-log__header">

              <span>Log de eventos</span>

              <button type="button" onClick={handleClearLog} disabled={!actionLog.length}>

                Limpiar

              </button>

            </div>

            {actionLog.length ? (

              <ul className="action-log__entries">

                {actionLog.map((entry) => (

                  <li key={entry.id}>

                    <span className="action-log__time">{entry.time}</span>

                    <span className="action-log__message">{entry.message}</span>

                  </li>

                ))}

              </ul>

            ) : (

              <p className="action-log__empty">Sin eventos registrados</p>

            )}

          </div>

        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

          <div className="controls-toolbar">

            <label className="resolution-toggle">

              <span>Resolucion</span>

              <select value={resolution} onChange={handleResolutionChange}>

                {resolutionOptions.map((option) => (

                  <option key={option.id} value={option.id}>

                    {option.label}

                  </option>

                ))}

              </select>

            </label>

            <div className="fullscreen-toggle">

              <button type="button" onClick={handleToggleFullscreen}>

                {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}

              </button>

            </div>

          </div>

          <div className="scheduled-events">

            <div className="scheduled-events__meta">

              <span className="scheduled-events__title">Eventos programados</span>

              <p className="scheduled-events__summary">P1 Sword Dance -&gt; P2 Play Rough (KO)</p>

            </div>

            <button

              type="button"

              className="scheduled-events__play"

              onClick={playScheduledSequence}

              disabled={isScheduledPlaying || hasEmptySlot || moveInProgress}

            >

              {isScheduledPlaying ? 'Reproduciendo...' : 'Play'}

            </button>

          </div>

          <div ref={containerRef} className="phaser-container" style={containerStyle}>

            {battleFeed.length > 0 && (

              <div className="battle-feed">

                {battleFeed.map((entry, idx) => {

                  const distanceFromLatest = battleFeed.length - 1 - idx

                  const variant =

                    distanceFromLatest === 0

                      ? ' battle-feed__entry--new'

                      : distanceFromLatest === 1

                        ? ' battle-feed__entry--recent'

                        : ' battle-feed__entry--older'

                  return (

                    <div key={`${entry}-${idx}`} className={`battle-feed__entry${variant}`}>

                      {entry}

                    </div>

                  )

                })}

              </div>

            )}

            {!hasEmptySlot &&

              !swapInProgress &&

              ALL_POKEMON_SLOTS.map((slot) => {

                const meta = resolveSlotMeta(slot)

                const slotState = battleStates[slot]

                return (

                  <div

                    key={slot}

                    className={`floating-health floating-health--${slot}`}

                    aria-label={`Vida ${meta?.nickname ?? 'Vacio'}`}

                  >

                    <div className="floating-health__meta">

                      <span>{meta ? `Lv. ${meta.level}` : 'Vacio'}</span>

                      {slotState && (

                        <span

                          className="status-pill"

                          style={{ backgroundColor: BATTLE_STATE_META[slotState].color }}

                          title={BATTLE_STATE_META[slotState].description}

                        >

                          {BATTLE_STATE_META[slotState].label}

                        </span>

                      )}

                      {meta?.status && STATUS_LABELS[meta.status] && (

                        <span className="status-pill">

                          {STATUS_LABELS[meta.status]}

                        </span>

                      )}

                    </div>

                    <span className="health-bar__label">{meta?.nickname ?? 'Vacio'}</span>

                    {meta ? (

                      <>

                        <SampleHealthBar value={getHpPercent(meta)} current={meta.hp.current} max={meta.hp.max} />

                        {renderStatStages(meta)}

                      </>

                    ) : (

                      <SampleHealthBar value={0} hideValue />

                    )}

                  </div>

                )


              })}
            {!hasEmptySlot && hasRoster && (

              <AttackPanel

                onSwap={(slot, selection) => triggerSwapPokemon(slot, selection)}

                teamOptions={backendTeams}

                activeSelection={slotSelections}

                onAttack={(payload) => handleAttackCommand(payload)}

                disabledSlots={ALL_POKEMON_SLOTS.reduce(

                  (acc, slot) => ({ ...acc, [slot]: isExecutingMove(slot) }),

                  {} as Record<PokemonSlot, boolean>

                )}

                hidden={

                  !hasRoster ||

                  ALL_POKEMON_SLOTS.some((slot) => isExecutingMove(slot)) ||

                  !slotSelections.p1?.moves?.length

                }

              />

            )}

          </div>



          {hasEmptySlot ? (

            <div className="control-log-row">

              <div className="action-panel action-panel--empty-slot">

                <span>Slot vacio</span>

                <p className="game-hint">Selecciona un nuevo Pokemon para continuar.</p>

                <PokemonSwapPanel

                  teams={backendTeams}

                  activeSelection={slotSelections}

                  onSwapPokemon={(slot, selection) => triggerSwapPokemon(slot, selection)}

                />

              </div>

            </div>

          ) : (

            <div className="control-log-row">

              <PokemonActionPanel

                availablePokemon={availablePokemonIds}

                teams={backendTeams}

                knownAnimationsById={knownAnimationsById}

                onPlayAnimation={(actorId, animationName, options) =>

                  requestAnimation(actorId, animationName, options)

                }

                onCameraBehavior={(request) => triggerCameraBehavior(request)}

                onSwapPokemon={(slot, selection) => triggerSwapPokemon(slot, selection)}

                onTestWhiteout={(slot, options) => triggerWhiteout(slot, options)}

                onSetBattleState={(slot, state) => handleSetBattleState(slot, state)}

                onLogEvent={(message) => handleLogEvent(message)}

                battleStates={battleStates}

                onApplyHpDelta={(slot, delta, options) => handleHpDeltaRequest(slot, delta, options)}

                onAdjustStage={(slot, stat, delta) => handleAdjustStage(slot, stat, delta)}

                stageValues={slotStages}

                weatherActive={weatherActive}

                onTriggerWeather={(payload) => handleTriggerWeather(payload)}

              />

              <div className="action-log">

                <div className="action-log__header">

                  <span>Log de eventos</span>

                  <button type="button" onClick={handleClearLog} disabled={!actionLog.length}>

                    Limpiar

                  </button>

                </div>

                {actionLog.length ? (

                  <ul className="action-log__entries">

                    {actionLog.map((entry) => (

                      <li key={entry.id}>

                        <span className="action-log__time">{entry.time}</span>

                        <span className="action-log__message">{entry.message}</span>

                      </li>

                    ))}

                  </ul>

                ) : (

                  <p className="action-log__empty">Sin eventos registrados</p>

                )}

              </div>

            </div>

          )}

          <CameraEffectsPanel onShakeCamera={handleShakeCamera} />

          <CameraControlsUI

            state={sceneDebugState}

            onUpdateCameraPosition={handleUpdateCameraPosition}

            onUpdateCameraLookAt={handleUpdateCameraLookAt}

            onUpdateActorPosition={handleUpdateActorPosition}

            onUpdateFov={handleUpdateCameraFov}

            onRefresh={handleRequestDebugState}

          />



          {animationPanels.map(({ id, names }) => (

            <div className="animation-panel" key={id}>

              <span>Animaciones {id.toUpperCase()}</span>

              {names.length > 0 ? (

                <div className="animation-list">

                  {names.map((name) => (

                    <button key={name} type="button" onClick={() => requestAnimation(id, name)}>

                      {name}

                    </button>

                  ))}

                </div>

              ) : (

                <p className="game-hint">No hay animaciones en este modelo.</p>

              )}

            </div>

          ))}

        </div>

      </div>

    </div>

  )

}





