import { Scene3D, THREE } from '@enable3d/phaser-extension'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type Phaser from 'phaser'
import type {
  CameraBehaviorRequest,
  CameraLookAtSpec,
  Vector3Spec,
  AxisValueSpec,
  CameraBehaviorAction,
} from '../types/cameraBehaviors'
import type { WeatherEffectType, WeatherEventPayload } from '../types/weather'
import { POKEMON_NAME_BY_ID } from '../data/dataAssign'
import { PokemonFxManager } from './PokemonFxManager'

const P1_POKEMON_IDS = ['0025', '0006', '0725'] as const
const P2_POKEMON_IDS = ['0445', '0920', '1097'] as const
const AVAILABLE_POKEMON_IDS = [...P1_POKEMON_IDS, ...P2_POKEMON_IDS] as const
export type PokemonSpecies = (typeof AVAILABLE_POKEMON_IDS)[number]
export type PokemonSlot = 'p1' | 'p2'
const AVAILABLE_POKEMON_IDS_BY_SLOT: Record<PokemonSlot, readonly PokemonSpecies[]> = {
  p1: P1_POKEMON_IDS,
  p2: P2_POKEMON_IDS,
}
type PokemonVariant = 'normal' | 'rare'
export type Vector3Like = { x: number; y: number; z: number }
export type SceneDebugState = {
  cameraPosition: Vector3Like
  cameraLookAt: Vector3Like
  cameraFov: number
  actors: Partial<Record<PokemonSlot, Vector3Like>>
}

type CameraUiUpdatePayload = {
  position?: Vector3Like
  lookAt?: Vector3Like
  duration?: number
}

type ActorPositionUpdatePayload = {
  id: PokemonSlot
  position: Vector3Like
}

type StageChangePayload = {
  slot: PokemonSlot
  type: 'buff' | 'debuff'
}

type PokemonHpDeltaPayload = {
  slot: PokemonSlot
  delta: number
}

export type PokemonSelection = {
  id: PokemonSpecies
  selectionId?: string
  form: string
  isRare: boolean
  transformation: string
  level: number
  nickname: string
  moves: string[]
  maxHp?: number
}

const normalizePokemonId = (id: PokemonSpecies) => id.replace(/^0+/, '') || '0'
const resolveDefaultForm = (id: PokemonSpecies) =>
  POKEMON_NAME_BY_ID[normalizePokemonId(id)]?.[0]?.[0] ?? '00_00'
const resolveDisplayName = (id: PokemonSpecies) => {
  const name = POKEMON_NAME_BY_ID[normalizePokemonId(id)]?.[0]?.[1]
  if (!name) return id
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const DEFAULT_FORM_BY_SPECIES: Record<PokemonSpecies, string> = AVAILABLE_POKEMON_IDS.reduce(
  (acc, species) => {
    acc[species] = resolveDefaultForm(species)
    return acc
  },
  {} as Record<PokemonSpecies, string>
)

export const MOVESET_BY_SPECIES: Record<PokemonSpecies, string[]> = {
  '0025': ['thunderbolt', 'quickattack', 'electroball', 'irontail'],
  '0006': ['flamethrower', 'dragonclaw', 'airslash', 'slash'],
  '0725': ['hydropump', 'darkpulse', 'icebeam', 'uturn'],
  '0445': ['earthquake', 'dragonclaw', 'stoneedge', 'swordsdance'],
  '0920': ['bravebird', 'ironhead', 'bulkup', 'roost'],
  '1097': ['spiritbreak', 'closecombat', 'psyshock', 'swordsdance'],
}

const DEFAULT_STATS_BY_SPECIES: Record<PokemonSpecies, { level: number; maxHp: number }> = {
  '0025': { level: 50, maxHp: 100 },
  '0006': { level: 70, maxHp: 170 },
  '0725': { level: 65, maxHp: 150 },
  '0445': { level: 72, maxHp: 190 },
  '0920': { level: 65, maxHp: 160 },
  '1097': { level: 75, maxHp: 170 },
}

const buildSelection = (slot: PokemonSlot, species: PokemonSpecies, overrides?: Partial<PokemonSelection>): PokemonSelection => ({
  id: species,
  selectionId: overrides?.selectionId ?? `${slot}-${species}${overrides?.isRare ? '-rare' : ''}`,
  form: overrides?.form ?? DEFAULT_FORM_BY_SPECIES[species],
  isRare: overrides?.isRare ?? false,
  transformation: overrides?.transformation ?? 'normal',
  level: overrides?.level ?? DEFAULT_STATS_BY_SPECIES[species].level,
  nickname: overrides?.nickname ?? resolveDisplayName(species),
  moves: overrides?.moves ?? MOVESET_BY_SPECIES[species],
  maxHp: overrides?.maxHp ?? DEFAULT_STATS_BY_SPECIES[species].maxHp,
})

const RARE_VARIANTS_BY_SLOT: Record<PokemonSlot, PokemonSpecies[]> = {
  p1: [],
  p2: [],
}

const buildSelectionsForSlot = (slot: PokemonSlot) =>
  AVAILABLE_POKEMON_IDS_BY_SLOT[slot].flatMap((species) => {
    const normal = buildSelection(slot, species, { isRare: false })
    const rare = buildSelection(slot, species, { isRare: true })
    const preferRare = RARE_VARIANTS_BY_SLOT[slot]?.includes(species)
    return preferRare ? [rare, normal] : [normal, rare]
  })

export const AVAILABLE_SELECTIONS_BY_SLOT: Record<PokemonSlot, PokemonSelection[]> = {
  p1: buildSelectionsForSlot('p1'),
  p2: buildSelectionsForSlot('p2'),
}

export const AVAILABLE_SPECIES_BY_SLOT: Record<PokemonSlot, PokemonSpecies[]> = {
  p1: Array.from(new Set(AVAILABLE_SELECTIONS_BY_SLOT.p1.map((entry) => entry.id))) as PokemonSpecies[],
  p2: Array.from(new Set(AVAILABLE_SELECTIONS_BY_SLOT.p2.map((entry) => entry.id))) as PokemonSpecies[],
}

export const DEFAULT_SLOT_SELECTION: Record<PokemonSlot, PokemonSelection> = {
  p1: AVAILABLE_SELECTIONS_BY_SLOT.p1[0],
  p2: AVAILABLE_SELECTIONS_BY_SLOT.p2[0],
}

const SPECIES_LIBRARY: Record<PokemonSpecies, { path: string; file: string }> = AVAILABLE_POKEMON_IDS.reduce(
  (acc, species) => {
    const paddedId = species.padStart(4, '0')
    const form = DEFAULT_FORM_BY_SPECIES[species]
    const filename = `pm${paddedId}_${form}`
    acc[species] = {
      path: `${import.meta.env.BASE_URL}pokemon/pm${paddedId}/${filename}/`,
      file: `${filename}.glb`,
    }
    return acc
  },
  {} as Record<PokemonSpecies, { path: string; file: string }>
)

const SLOT_CONFIG: Record<
  PokemonSlot,
  { position: [number, number, number]; orientationY: number; anchorToBack: boolean }
> = {
  p1: { position: [0, 0, 3.2], orientationY: Math.PI, anchorToBack: false },
  p2: { position: [0, 0, -3.2], orientationY: 0, anchorToBack: true },
}

type AnimationRequest = {
  id: string
  name: string
  actionId?: string
  actionLabel?: string
  initiatorId?: string
}
type SwapRequest = {
  slot: PokemonSlot
  species: PokemonSpecies
  selectionId?: string
  isRare?: boolean
  skipImplode?: boolean
}
type WhiteoutRequest = {
  slot: PokemonSlot
  duration?: number
  respawnAfter?: boolean
  withParticles?: boolean
}
const isPokemonSlotId = (value: string): value is PokemonSlot => value === 'p1' || value === 'p2'
type PokemonActor = {
  object: THREE.Object3D
  mixer: THREE.AnimationMixer
  bounds: THREE.BoxHelper
  animations: THREE.AnimationClip[]
  height: number
  finishHandler: (event: THREE.Event & { action: THREE.AnimationAction }) => void
}

export class PlaygroundScene extends Scene3D {
  private ground?: THREE.Mesh
  private modelCache = new Map<
    PokemonSpecies,
    { scene: THREE.Object3D; animations: THREE.AnimationClip[]; parser?: GLTF['parser'] }
  >()
  private pokemonActors = new Map<string, PokemonActor>()
  private orbitControls?: OrbitControls
  private readonly cameraAnimation = {
    startPosition: new THREE.Vector3(),
    targetPosition: new THREE.Vector3(),
    startLookAt: new THREE.Vector3(),
    targetLookAt: new THREE.Vector3(),
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    duration: 0,
    elapsed: 0,
    active: false,
    resolve: undefined as (() => void) | undefined,
    promise: null as Promise<void> | null,
  }
  private readonly cameraLookAt = new THREE.Vector3()
  private cameraLookAtInitialized = false
  private readonly overviewCameraPosition = new THREE.Vector3(1.4, 0.3, 5.1)
  private readonly overviewCameraLookAt = new THREE.Vector3(-1.5, 0.6, 0)
  private readonly cameraDirectionHelper = new THREE.Vector3()
  private readonly defaultAnimationPatterns = [
    'defaultwait01_loop.tranm',
    'battlewait01_loop.tranm',
  ].map((pattern) => pattern.toLowerCase())
  private readonly currentSelectionIdBySlot: Record<PokemonSlot, string | null> = {
    p1: DEFAULT_SLOT_SELECTION.p1.selectionId ?? null,
    p2: DEFAULT_SLOT_SELECTION.p2.selectionId ?? null,
  }
  private readonly stageFxQueues: Record<PokemonSlot, StageChangePayload['type'][]> = {
    p1: [],
    p2: [],
  }
  private readonly stageFxRunning: Record<PokemonSlot, boolean> = {
    p1: false,
    p2: false,
  }
  private readonly activeAnimationActions = new Map<string, THREE.AnimationAction>()
  private readonly actorHomePositions = new Map<string, THREE.Vector3>()
  private readonly actorFreezeCounts = new Map<string, number>()
  private readonly cameraShake = {
    active: false,
    duration: 0,
    elapsed: 0,
    intensity: 0,
    previousPositionOffset: new THREE.Vector3(),
    previousLookOffset: new THREE.Vector3(),
  }
  private pendingCameraActions: Array<{ action: CameraBehaviorAction; behaviorId?: string }> = []
  private cameraActionsProcessing = false
  private readonly behaviorActionCounts = new Map<string, number>()
  private readonly activeBehaviors = new Map<string, { initiatorId?: string; label?: string }>()
  private animationFollowUps = new Map<
    string,
    { clipName?: string; actions: CameraBehaviorAction[]; behaviorId?: string }
  >()
  private readonly pendingSimpleActions = new Map<
    string,
    { actionId: string; clip: string; label?: string; initiatorId: string }
  >()
  private readonly swappingSlots = new Set<PokemonSlot>()
  private activeWeatherId: string | null = null
  private activeWeatherType: WeatherEffectType | null = null
  private fx!: PokemonFxManager
  private debugStateTimer?: Phaser.Time.TimerEvent
  private readonly handleDebugStateRequest = () => this.emitDebugState()
  private readonly handleUiCameraUpdate = (payload: CameraUiUpdatePayload) => {
    const camera = this.third.camera as THREE.PerspectiveCamera
    if (!camera) return
    const nextPosition = payload.position
      ? new THREE.Vector3(payload.position.x, payload.position.y, payload.position.z)
      : camera.position.clone()
    const nextLookAt = payload.lookAt
      ? new THREE.Vector3(payload.lookAt.x, payload.lookAt.y, payload.lookAt.z)
      : this.cameraLookAt.clone()
    this.transitionCamera(nextPosition, nextLookAt, payload.duration ?? 0)
  }
  private readonly handleUiActorPositionUpdate = ({ id, position }: ActorPositionUpdatePayload) => {
    const actor = this.pokemonActors.get(id)
    if (!actor) return
    actor.object.position.set(position.x, position.y, position.z)
    actor.bounds.update()
    this.actorHomePositions.set(id, actor.object.position.clone())
    this.emitDebugState()
  }
  private readonly handleUiFovUpdate = (value: number) => {
    const camera = this.third.camera as THREE.PerspectiveCamera
    if (!camera || !camera.isPerspectiveCamera) return
    const clamped = THREE.MathUtils.clamp(value, 10, 130)
    if (Math.abs(camera.fov - clamped) < 1e-3) return
    camera.fov = clamped
    camera.updateProjectionMatrix()
    this.emitDebugState()
  }

  private readonly handleStageChangeEvent = ({ slot, type }: StageChangePayload) => {
    this.stageFxQueues[slot].push(type)
    if (!this.stageFxRunning[slot]) {
      void this.processStageFxQueue(slot)
    }
  }

  private async processStageFxQueue(slot: PokemonSlot) {
    if (this.stageFxRunning[slot]) return
    const next = this.stageFxQueues[slot].shift()
    if (!next) return
    this.stageFxRunning[slot] = true
    this.game.events.emit('pokemon:stageFxStart', { slot, type: next })
    const promise = this.fx?.playStatChangeParticles(slot, next)
    if (promise?.then) {
      await promise
    }
    this.game.events.emit('pokemon:stageFxComplete', { slot, type: next })
    this.stageFxRunning[slot] = false
    if (this.stageFxQueues[slot].length) {
      void this.processStageFxQueue(slot)
    }
  }

  private resolveWeatherLabel(type: WeatherEffectType) {
    switch (type) {
      case 'rain':
        return 'Clima: Lluvia'
      case 'snowscape':
        return 'Clima: Snowscape'
      case 'sunnyday':
        return 'Clima: Soleado'
      case 'sandstorm':
        return 'Clima: Tormenta de Arena'
      case 'deltastream':
        return 'Clima: Delta Stream'
    }
    return 'Clima'
  }

  private startWeatherEffect(type: WeatherEffectType) {
    if (!this.fx) return false
    switch (type) {
      case 'rain':
        return this.fx.startRainWeather()
      case 'snowscape':
        return this.fx.startSnowscapeWeather()
      case 'sunnyday':
        return this.fx.startSunnyDayWeather()
      case 'sandstorm':
        return this.fx.startSandstormWeather()
      case 'deltastream':
        return this.fx.startDeltaStreamWeather()
      default:
        return false
    }
  }

  private getDefaultVariantFor(species: PokemonSpecies, slot: PokemonSlot): PokemonVariant {
    const selection = DEFAULT_SLOT_SELECTION[slot]
    if (selection && selection.id === species) {
      return selection.isRare ? 'rare' : 'normal'
    }
    return 'normal'
  }

  private stopWeatherEffect(type: WeatherEffectType) {
    if (!this.fx) return false
    switch (type) {
      case 'rain':
        return this.fx.stopRainWeather()
      case 'snowscape':
        return this.fx.stopSnowscapeWeather()
      case 'sunnyday':
        return this.fx.stopSunnyDayWeather()
      case 'sandstorm':
        return this.fx.stopSandstormWeather()
      case 'deltastream':
        return this.fx.stopDeltaStreamWeather()
      default:
        return false
    }
  }

  private readonly handleWeatherEvent = (payload: WeatherEventPayload) => {
    if (!payload || !this.fx) return
    const action = payload.action ?? 'start'
    if (action === 'stop') {
      if (!this.activeWeatherId) return
      const targetType = payload.type ?? this.activeWeatherType
      if (!targetType) return
      const stopped = this.stopWeatherEffect(targetType)
      if (!stopped) return
      const label = payload.label ?? this.resolveWeatherLabel(targetType)
      this.game.events.emit('pokemon:actionComplete', {
        id: this.activeWeatherId,
        initiatorId: 'weather',
        label,
      })
      this.game.events.emit('battle:weatherComplete', {
        id: this.activeWeatherId,
        type: targetType,
        label,
      })
      this.activeWeatherId = null
      this.activeWeatherType = null
      return
    }

    if (this.activeWeatherId) return
    const type = payload.type
    if (!type) return
    const weatherId = payload.id ?? `weather:${type}:${Date.now()}`
    const label = payload.label ?? this.resolveWeatherLabel(type)
    if (!this.startWeatherEffect(type)) return
    this.activeWeatherId = weatherId
    this.activeWeatherType = type
    this.game.events.emit('pokemon:actionStart', {
      id: weatherId,
      initiatorId: 'weather',
      label,
    })
  }


  private readonly handlePlayRequest = ({
    id,
    name,
    actionId,
    actionLabel,
    initiatorId,
  }: AnimationRequest) => {
    if ((id === 'p1' || id === 'p2') && this.swappingSlots.has(id)) {
      return
    }
    if (actionId) {
      const resolvedInitiator = initiatorId ?? id
      this.pendingSimpleActions.set(id, {
        actionId,
        clip: name.toLowerCase(),
        label: actionLabel,
        initiatorId: resolvedInitiator,
      })
      this.game.events.emit('pokemon:actionStart', {
        id: actionId,
        initiatorId: resolvedInitiator,
        label: actionLabel,
      })
    } else {
      this.pendingSimpleActions.delete(id)
    }
    const clip = this.playAnimation(id, name)
    if (
      clip &&
      isPokemonSlotId(id) &&
      name.toLowerCase().includes('down01_start') &&
      actionLabel === 'Debilitamiento'
    ) {
      this.scheduleWhiteoutAtMidAnimation(id, clip, { respawnAfter: false, withParticles: true })
    }
  }
  private readonly handleCameraBehaviorEvent = (request: CameraBehaviorRequest) => {
    this.applyCameraBehavior(request)
  }
  private readonly handleSwapRequest = ({ slot, species, selectionId, isRare, skipImplode }: SwapRequest) => {
    this.currentVariantBySlot[slot] =
      isRare === true ? 'rare' : isRare === false ? 'normal' : this.getDefaultVariantFor(species, slot)
    const actionId = `swap:${slot}:${Date.now()}`
    this.game.events.emit('pokemon:actionStart', {
      id: actionId,
      initiatorId: slot,
      label: 'Cambio de Pokemon',
    })
    void this.swapPokemon(slot, species, { skipImplode, actionId, selectionId })
  }
  private readonly handleWhiteoutRequest = async ({
    slot,
    duration,
    respawnAfter,
    withParticles,
  }: WhiteoutRequest) => {
    const shouldRespawn = respawnAfter ?? true
    if (withParticles) {
      this.fx.playSwapParticles(slot, true)
    }
    if (shouldRespawn) {
      this.whiteoutAndRespawn(slot, duration)
    } else {
      await this.fx.whitenAndShrinkPokemon(slot, duration, { targetScale: 0 })
      this.removePokemonActor(slot)
      this.registerAnimations()
      this.game.events.emit('pokemon:slotEmpty', { slot })
      this.game.events.emit('pokemon:actionComplete', {
        id: `whiteout:${slot}`,
        initiatorId: slot,
        label: 'Whiteout',
      })
    }
  }
  private readonly handleHpDeltaEvent = ({ slot, delta }: PokemonHpDeltaPayload) => {
    if (delta > 0 && this.fx) {
      this.fx.playHealingParticles(slot)
    }
  }
  private readonly currentSpeciesBySlot: Record<PokemonSlot, PokemonSpecies> = {
    p1: DEFAULT_SLOT_SELECTION.p1.id,
    p2: DEFAULT_SLOT_SELECTION.p2.id,
  }
  private readonly currentVariantBySlot: Record<PokemonSlot, PokemonVariant> = {
    p1: this.getDefaultVariantFor(DEFAULT_SLOT_SELECTION.p1.id, 'p1'),
    p2: this.getDefaultVariantFor(DEFAULT_SLOT_SELECTION.p2.id, 'p2'),
  }

  constructor() {
    super({ key: 'PlaygroundScene' })
  }

  init() {
    this.accessThirdDimension({
      antialias: true,
      usePhysics: false,
    })
  }

  async create() {
    const { lights, orbitControls } = await this.third.warpSpeed('light', 'camera', 'orbitControls')

    if (lights?.ambientLight) lights.ambientLight.intensity = 4
    if (lights?.directionalLight) {
      lights.directionalLight.intensity = 2
      lights.directionalLight.position.set(4, 6, 2)
    }
    if (orbitControls) {
      this.orbitControls = orbitControls
      orbitControls.enablePan = true
      orbitControls.enableZoom = true
      orbitControls.enableDamping = true
      orbitControls.dampingFactor = 0.08
      orbitControls.minDistance = 4
      orbitControls.maxDistance = 16
      orbitControls.target.set(0, 1.5, 0)
      orbitControls.update()
    }

    this.third.scene.background = new THREE.Color('#000000')

    const perspectiveCamera = this.third.camera as THREE.PerspectiveCamera
    if (perspectiveCamera.isPerspectiveCamera) {
      perspectiveCamera.fov = 50
      perspectiveCamera.near = 0.1
      perspectiveCamera.far = 50
      perspectiveCamera.updateProjectionMatrix()
    }

    this.fx = new PokemonFxManager({
      getActor: (slot) => this.pokemonActors.get(slot),
      getScene: () => this.third.scene,
      time: this.time,
      tweens: this.tweens,
    })

    this.createGround()
    const initialSelections = {
      p1: await this.resolveInitialSelection('p1'),
      p2: await this.resolveInitialSelection('p2'),
    }

    await Promise.all([
      this.spawnPokemon('p1', this.currentSpeciesBySlot.p1, false, this.currentVariantBySlot.p1, initialSelections.p1.selectionId),
      this.spawnPokemon('p2', this.currentSpeciesBySlot.p2, false, this.currentVariantBySlot.p2, initialSelections.p2.selectionId),
    ])

    // Configurar cÃ¡mara con altura dinÃ¡mica basada en p1
    const p1Actor = this.pokemonActors.get('p1')
    const dynamicHeight = p1Actor ? p1Actor.height *0.3 : 0.4

    this.overviewCameraPosition.y = dynamicHeight
    this.transitionCamera(this.overviewCameraPosition, this.overviewCameraLookAt, 1.2)

    this.registerAnimations()
    this.preloadRemainingModels()

    this.game.events.on('pokemon:play', this.handlePlayRequest)
    this.game.events.on('camera:behavior', this.handleCameraBehaviorEvent)
    this.game.events.on('pokemon:swap', this.handleSwapRequest)
    this.game.events.on('pokemon:whiteout', this.handleWhiteoutRequest)
    this.game.events.on('scene:requestDebugState', this.handleDebugStateRequest)
    this.game.events.on('scene:updateCamera', this.handleUiCameraUpdate)
    this.game.events.on('scene:updateActorPosition', this.handleUiActorPositionUpdate)
    this.game.events.on('scene:updateCameraFov', this.handleUiFovUpdate)
    this.game.events.on('pokemon:stageChange', this.handleStageChangeEvent)
    this.game.events.on('pokemon:hpDelta', this.handleHpDeltaEvent)
    this.game.events.on('battle:weather', this.handleWeatherEvent)

    this.debugStateTimer = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.emitDebugState(),
    })
    this.emitDebugState()

    this.events.once('shutdown', () => {
      this.game.events.off('pokemon:play', this.handlePlayRequest)
      this.game.events.off('camera:behavior', this.handleCameraBehaviorEvent)
      this.game.events.off('pokemon:swap', this.handleSwapRequest)
      this.game.events.off('pokemon:whiteout', this.handleWhiteoutRequest)
      this.game.events.off('scene:requestDebugState', this.handleDebugStateRequest)
      this.game.events.off('scene:updateCamera', this.handleUiCameraUpdate)
      this.game.events.off('scene:updateActorPosition', this.handleUiActorPositionUpdate)
      this.game.events.off('scene:updateCameraFov', this.handleUiFovUpdate)
      this.game.events.off('pokemon:stageChange', this.handleStageChangeEvent)
      this.game.events.off('pokemon:hpDelta', this.handleHpDeltaEvent)
      this.game.events.off('battle:weather', this.handleWeatherEvent)
      this.debugStateTimer?.remove(false)
      this.debugStateTimer = undefined
      this.stopCameraShake()
      this.pokemonActors.forEach(({ mixer, bounds, finishHandler }, actorId) => {
        mixer.stopAllAction()
        mixer.removeEventListener('finished', finishHandler)
        this.third.scene.remove(bounds)
        this.activeAnimationActions.delete(actorId)
      })
      this.pokemonActors.clear()
      this.activeAnimationActions.clear()
      this.actorHomePositions.clear()
      this.actorFreezeCounts.clear()
    })
  }

  update(_time: number, delta: number) {
    const deltaSeconds = delta / 1000
    this.updateCameraTransition(deltaSeconds)
    this.updateCameraShake(deltaSeconds)
    this.pokemonActors.forEach(({ mixer, bounds }) => {
      mixer.update(deltaSeconds)
      bounds.update()
    })
  }

  private emitDebugState() {
    const camera = this.third.camera as THREE.PerspectiveCamera
    if (!camera) return
    const actors: Partial<Record<PokemonSlot, Vector3Like>> = {}
    this.pokemonActors.forEach(({ object }, actorId) => {
      if (actorId === 'p1' || actorId === 'p2') {
        actors[actorId as PokemonSlot] = {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        }
      }
    })
    const state: SceneDebugState = {
      cameraPosition: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      cameraLookAt: {
        x: this.cameraLookAt.x,
        y: this.cameraLookAt.y,
        z: this.cameraLookAt.z,
      },
      cameraFov: camera.isPerspectiveCamera ? camera.fov : 0,
      actors,
    }
    this.game.events.emit('scene:debugState', state)
  }

  private async loadModel(key: PokemonSpecies) {
    if (this.modelCache.has(key)) return this.modelCache.get(key)!

    const manager = new THREE.LoadingManager()
    const dracoLoader = new DRACOLoader(manager)
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
    dracoLoader.preload()

    const loader = new GLTFLoader(manager)
    const { path, file } = SPECIES_LIBRARY[key]
    loader.setPath(path)
    loader.setDRACOLoader(dracoLoader)
    let gltf: GLTF
    try {
      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(file, resolve, undefined, reject)
      })
    } catch (error) {
      console.error(
        `[PlaygroundScene] Failed to load model ${key} from ${path}${file}. ` +
          'This usually means the asset is missing or the form id is wrong.',
        error
      )
      throw error
    } finally {
      dracoLoader.dispose()
    }

    const data = { scene: gltf.scene, animations: gltf.animations ?? [], parser: gltf.parser }
    this.modelCache.set(key, data)
    return data
  }

  private async resolveInitialSelection(slot: PokemonSlot): Promise<PokemonSelection> {
    const candidates = AVAILABLE_SELECTIONS_BY_SLOT[slot]
    const tried = new Set<PokemonSpecies>()
    for (const selection of candidates) {
      if (tried.has(selection.id)) continue
      tried.add(selection.id)
      try {
        await this.loadModel(selection.id)
        this.currentSpeciesBySlot[slot] = selection.id
        this.currentVariantBySlot[slot] = this.getDefaultVariantFor(selection.id, slot)
        this.setSelectionForSlot(slot, selection.selectionId)
        return selection
      } catch (error) {
        console.warn(
          `[PlaygroundScene] Could not preload model for ${slot} -> ${selection.id} (${selection.form}):`,
          error
        )
      }
    }
    throw new Error(`No loadable models found for slot ${slot}`)
  }

  private setSelectionForSlot(slot: PokemonSlot, selectionId?: string | null) {
    this.currentSelectionIdBySlot[slot] = selectionId ?? null
  }

  private async applyMaterialVariant(
    scene: THREE.Object3D,
    parser: GLTF['parser'] | undefined,
    variant: PokemonVariant
  ) {
    if (!parser || !scene) return
    const parserAny = parser as any
    const variantsExt = parserAny.extensions?.KHR_materials_variants
    const variantsList =
      variantsExt?.variants ??
      parserAny.json?.extensions?.KHR_materials_variants?.variants ??
      []

    const variantIndex = variantsList.findIndex((entry: any) => entry?.name === variant)

    if (variantsExt && variantIndex !== undefined && variantIndex !== null && variantIndex >= 0) {
      //console.log('[applyMaterialVariant] Applying variant via extension', variant, 'index', variantIndex)
      scene.traverse((child: any) => {
        if (child?.isMesh) {
          variantsExt.selectVariant(child, variantIndex)
        }
      })
      return
    }

    // Fallback manual assignment using userData mappings (in case the extension is not exposed).
    const applyPromises: Promise<void>[] = []
    scene.traverse((child: any) => {
      if (!child?.isMesh) return
      const mappings: any[] =
        child.userData?.gltfExtensions?.KHR_materials_variants?.mappings ?? []
      const mapping = mappings.find((entry) =>
        entry?.variants?.some((idx: number) => {
          const v = variantsList?.[idx]
          return v?.name === variant
        })
      )
      if (!mapping || mapping.material === undefined) return
      applyPromises.push(
        parser.getDependency('material', mapping.material).then((mat: any) => {
          child.material = mat
        })
      )
    })

    if (applyPromises.length) {
      await Promise.all(applyPromises)
     // console.log('[applyMaterialVariant] Applied variant via fallback', variant)
    } else {
     // console.warn('[applyMaterialVariant] Variant not found or no mapping for', variant)
    }
  }

  private async spawnPokemon(
    slot: PokemonSlot,
    species: PokemonSpecies,
    withFallAnimation: boolean = false,
    variant: PokemonVariant = this.getDefaultVariantFor(species, slot),
    selectionId?: string
  ) {
    const config = SLOT_CONFIG[slot]
    const position = new THREE.Vector3(...config.position)
    const modelData = await this.loadModel(species)
    const model = cloneSkinned(modelData.scene)
    await this.applyMaterialVariant(model, modelData.parser, variant)

    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return

      // Clonar materiales por instancia para evitar que efectos como whiteout
      // afecten a otros modelos que compartan referencias.
      const material = mesh.material
      if (Array.isArray(material)) {
        mesh.material = material.map((mat) =>
          mat && typeof (mat as THREE.Material).clone === 'function'
            ? (mat as THREE.Material).clone()
            : mat
        )
      } else if (material && typeof (material as THREE.Material).clone === 'function') {
        mesh.material = (material as THREE.Material).clone()
      }

      // Habilitar sombras sin reemplazar los materiales originales
      mesh.castShadow = true
      mesh.receiveShadow = true
    })

    const root = new THREE.Group()
    root.name = `pokemon-${slot}`
    root.add(model)

    root.position.copy(position)
    root.rotation.y = config.orientationY
    this.third.scene.add(root)

    // Calcular bounding box del modelo en su posición actual
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)

    // Calcular altura del modelo
    const height = box.max.y - box.min.y

    // Mover el root según el ancla especificado
    const offsetZ = config.anchorToBack ? (box.max.z - position.z) : (box.min.z - position.z)
    root.position.z -= offsetZ

    const mixer = new THREE.AnimationMixer(root)
    const finishHandler = (event: THREE.Event & { action: THREE.AnimationAction }) => {
      this.handleAnimationFinished(slot, event)
    }
    mixer.addEventListener('finished', finishHandler)

    const bounds = new THREE.BoxHelper(root, 0x55ccff)
   /*  this.third.scene.add(bounds) */

    this.pokemonActors.set(slot, { object: root, mixer, bounds, animations: modelData.animations, height, finishHandler })
    this.actorHomePositions.set(slot, root.position.clone())
    this.currentSpeciesBySlot[slot] = species
    this.setSelectionForSlot(slot, selectionId ?? null)

    // Si hay animación de caída, elevar el modelo primero
    if (withFallAnimation) {
      const fallHeight = 0.5 // Altura desde donde cae
      root.position.y += fallHeight
    }

    // Ejecutar partículas y whitein simultáneamente
    const restorePromise = this.fx.restorePokemonAppearance(slot)
    this.fx.playSwapParticles(slot)


    const landingClip = this.findClip(this.pokemonActors.get(slot)!, 'land02.tranm')
    if (landingClip?.name) {
      this.animationFollowUps.set(slot, {
        clipName: landingClip.name,
        actions: [{ type: 'playIdleRandom', id: slot }],
      })
      this.playClip(slot, this.pokemonActors.get(slot)!, landingClip)
    } else {
      this.playDefaultAnimation(slot)
    }
    // Animación de caída si está habilitada
    if (withFallAnimation) {
      // Esperar 500ms antes de iniciar la caída
      await new Promise<void>((resolve) => {
        this.time.delayedCall(200, resolve)
      })
      await this.animatePokemonFall(slot)
    }


    await restorePromise
  }

  private animatePokemonFall(slot: PokemonSlot): Promise<void> {
    const actor = this.pokemonActors.get(slot)
    if (!actor) return Promise.resolve()

    const homePosition = this.actorHomePositions.get(slot)
    if (!homePosition) return Promise.resolve()

    const startY = actor.object.position.y
    const targetY = homePosition.y

    return new Promise<void>((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 600, // Duración de la caída
        ease: 'Cubic.easeIn', // Aceleración como gravedad
        onUpdate: (tween) => {
          const t = Number(tween.getValue())
          actor.object.position.y = THREE.MathUtils.lerp(startY, targetY, t)
          actor.bounds.update()
        },
        onComplete: () => {
          actor.object.position.y = targetY
          actor.bounds.update()
          resolve()
        },
      })
    })
  }


  private async precalculateModelHeight(species: PokemonSpecies, slot: PokemonSlot): Promise<number> {
    const config = SLOT_CONFIG[slot]
    const position = new THREE.Vector3(...config.position)
    const modelData = await this.loadModel(species)
    const tempModel = cloneSkinned(modelData.scene)

    const tempRoot = new THREE.Group()
    tempRoot.add(tempModel)
    tempRoot.position.copy(position)
    tempRoot.rotation.y = config.orientationY

    // Calcular bounding box temporalmente
    tempRoot.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(tempRoot)
    const height = box.max.y - box.min.y

    // Limpiar recursos temporales
    tempRoot.clear()
    tempModel.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        if (mesh.geometry) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose())
        } else if (mesh.material) {
          mesh.material.dispose()
        }
      }
    })

    

    return height
  }
  private removePokemonActor(slot: PokemonSlot) {
    const existing = this.pokemonActors.get(slot)
    if (!existing) return
    existing.mixer.stopAllAction()
    existing.mixer.removeEventListener('finished', existing.finishHandler)
    this.pokemonActors.delete(slot)
    this.animationFollowUps.delete(slot)
    this.pendingSimpleActions.delete(slot)
    this.activeAnimationActions.delete(slot)
    this.actorHomePositions.delete(slot)
    this.actorFreezeCounts.delete(slot)
    this.third.scene.remove(existing.object)
    this.third.scene.remove(existing.bounds)
  }

  private async swapPokemon(
    slot: PokemonSlot,
    species: PokemonSpecies,
    options?: { skipImplode?: boolean; actionId?: string; selectionId?: string }
  ) {
    if (this.swappingSlots.has(slot)) {
      return
    }

    this.swappingSlots.add(slot)
    const existing = this.pokemonActors.get(slot)
    let swapFailed = false
    try {
      await this.waitForCameraTransitionToSettle()
      const newHeight = await this.precalculateModelHeight(species, slot)
      if (existing) {
        // Crear partículas antes de desvanecer
        if (!options?.skipImplode) {
          this.fx.playSwapParticles(slot, true) // <- IMPLOSIÓN
        }

        await this.fx.whitenAndShrinkPokemon(slot)
        this.removePokemonActor(slot)
      }

      if (slot === 'p1') {
        this.overviewCameraPosition.y = newHeight * 0.3
      }
      this.transitionCamera(this.overviewCameraPosition, this.overviewCameraLookAt, 1.2)

      await this.waitForCameraTransitionToSettle()

      await this.spawnPokemon(slot, species, true, this.currentVariantBySlot[slot], options?.selectionId) // true = con animación de caída

      this.registerAnimations()
    } catch (error) {
      swapFailed = true
      console.error(`[PlaygroundScene] Swap failed for ${slot} -> ${species}`, error)
    } finally {
      this.swappingSlots.delete(slot)
      if (options?.actionId) {
        this.game.events.emit('pokemon:actionComplete', {
          id: options.actionId,
          initiatorId: slot,
          label: swapFailed ? 'Cambio de Pokemon (fallido)' : 'Cambio de Pokemon',
        })
      }
    }
  }

  private async whiteoutAndRespawn(slot: PokemonSlot, duration?: number) {
    if (!this.pokemonActors.has(slot)) return
    await this.fx.whitenAndShrinkPokemon(slot, duration)
    this.removePokemonActor(slot)
    const species = this.currentSpeciesBySlot[slot]
    await this.spawnPokemon(
      slot,
      species,
      false,
      this.currentVariantBySlot[slot],
      this.currentSelectionIdBySlot[slot] ?? undefined
    )
    this.registerAnimations()
  }


  private createGround() {
    const geometry = new THREE.CircleGeometry(6, 64)
    const material = new THREE.MeshStandardMaterial({
      color: 0x10172b,
      roughness: 0.9,
      metalness: 0.05,
      emissive: new THREE.Color('#030509'),
      emissiveIntensity: 0.3,
    })

    this.ground = new THREE.Mesh(geometry, material)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.set(0, 0, 0)
    this.ground.receiveShadow = true
    this.third.scene.add(this.ground)

    const grid = new THREE.GridHelper(30, 30, 0x3e71ff, 0x1a2034)
    grid.position.y = 0.01
    this.third.scene.add(grid)
  }

  private playDefaultAnimation(id: string) {
    const actor = this.pokemonActors.get(id)
    if (!actor || !actor.animations.length) return

    const clip = this.getDefaultAnimationClip(actor)
    if (!clip) return

    this.playClip(id, actor, clip, 0.05, true)
  }

  private getDefaultAnimationClip(actor: PokemonActor) {
    if (!actor.animations.length) return undefined
    const patterns = this.defaultAnimationPatterns
    const matchingClips = actor.animations.filter((clip) => {
      const name = (clip.name ?? '').toLowerCase()
      return name.includes('_loop') && patterns.some((pattern) => name.includes(pattern))
    })

    if (matchingClips.length > 0) {
      const randomIndex = Math.floor(Math.random() * matchingClips.length)
      return matchingClips[randomIndex]
    }

    return actor.animations[0]
  }

  private handleAnimationFinished(id: string, event: THREE.Event & { action: THREE.AnimationAction }) {
    const actor = this.pokemonActors.get(id)
    if (!actor) return
    const currentAction = this.activeAnimationActions.get(id)
    if (!currentAction || currentAction !== event.action) return

    const defaultClip = this.getDefaultAnimationClip(actor)
    if (!defaultClip) return

    const finishedClip = event.action.getClip()
    const followUpHandled = this.triggerAnimationFollowUps(id, finishedClip?.name)
    this.resolveSimpleActionCompletion(id, finishedClip?.name)
    if (finishedClip === defaultClip) {
      if (followUpHandled) return
      event.action.reset().play()
      return
    }

    if (followUpHandled) return
    this.playClip(id, actor, defaultClip, 0.35, true)
  }

  private resolveSimpleActionCompletion(actorId: string, clipName?: string) {
    if (!clipName) return
    const pending = this.pendingSimpleActions.get(actorId)
    if (!pending) return
    if (!this.clipNameMatchesTarget(clipName, pending.clip)) return
    this.pendingSimpleActions.delete(actorId)
    this.game.events.emit('pokemon:actionComplete', {
      id: pending.actionId,
      initiatorId: pending.initiatorId,
      label: pending.label,
    })
  }

  private transitionCamera(position: THREE.Vector3, lookAt: THREE.Vector3, duration: number = 0.8) {
    const camera = this.third.camera as THREE.PerspectiveCamera
    if (duration <= 0) {
      camera.position.copy(position)
      camera.lookAt(lookAt)
      this.cameraLookAt.copy(lookAt)
      this.cameraLookAtInitialized = true
      if (this.orbitControls) {
        this.orbitControls.target.copy(lookAt)
        this.orbitControls.update()
      }
      this.cameraAnimation.active = false
      this.resolveCameraAnimationPromise()
      return
    }

    if (!this.cameraLookAtInitialized) {
      const direction = this.cameraDirectionHelper
      camera.getWorldDirection(direction)
      if (direction.lengthSq() === 0) {
        direction.set(0, 0, -1)
      }
      direction.multiplyScalar(10).add(camera.position)
      this.cameraLookAt.copy(direction)
      this.cameraLookAtInitialized = true
    }

    const anim = this.cameraAnimation
    anim.startPosition.copy(camera.position)
    anim.startLookAt.copy(this.cameraLookAt)
    anim.targetPosition.copy(position)
    anim.targetLookAt.copy(lookAt)
    anim.duration = duration
    anim.elapsed = 0
    anim.active = true
    this.getOrCreateCameraAnimationPromise()
  }

  private updateCameraTransition(deltaSeconds: number) {
    const anim = this.cameraAnimation
    if (!anim.active) return

    anim.elapsed = Math.min(anim.elapsed + deltaSeconds, anim.duration)
    const t = anim.duration === 0 ? 1 : anim.elapsed / anim.duration
    const eased = this.easeInOutCubic(t)

    anim.currentPosition.copy(anim.startPosition).lerp(anim.targetPosition, eased)
    anim.currentLookAt.copy(anim.startLookAt).lerp(anim.targetLookAt, eased)

    const camera = this.third.camera as THREE.PerspectiveCamera
    camera.position.copy(anim.currentPosition)
    camera.lookAt(anim.currentLookAt)
    this.cameraLookAt.copy(anim.currentLookAt)

    if (this.orbitControls) {
      this.orbitControls.target.copy(anim.currentLookAt)
      this.orbitControls.update()
    }

    if (t >= 1) {
      anim.active = false
      this.resolveCameraAnimationPromise()
    }
  }

  private waitForCameraTransitionToSettle(): Promise<void> {
    const anim = this.cameraAnimation
    if (!anim.active) return Promise.resolve()
    return this.getOrCreateCameraAnimationPromise()
  }

  private getOrCreateCameraAnimationPromise(): Promise<void> {
    const anim = this.cameraAnimation
    if (!anim.promise) {
      anim.promise = new Promise<void>((resolve) => {
        anim.resolve = () => {
          anim.resolve = undefined
          anim.promise = null
          resolve()
        }
      })
    }
    return anim.promise
  }

  private resolveCameraAnimationPromise() {
    const anim = this.cameraAnimation
    if (anim.resolve) {
      const resolve = anim.resolve
      anim.resolve = undefined
      anim.promise = null
      resolve()
    } else {
      anim.promise = null
    }
  }

  private updateCameraShake(deltaSeconds: number) {
    const shake = this.cameraShake
    if (!shake.active) return

    const camera = this.third.camera as THREE.PerspectiveCamera
    camera.position.sub(shake.previousPositionOffset)
    this.cameraLookAt.sub(shake.previousLookOffset)
    if (this.orbitControls) {
      this.orbitControls.target.sub(shake.previousLookOffset)
    }

    shake.elapsed += deltaSeconds
    if (shake.elapsed >= shake.duration) {
      this.stopCameraShake()
      return
    }

    const progress = shake.duration === 0 ? 1 : shake.elapsed / shake.duration
    const falloff = 1 - progress
    const intensity = shake.intensity * falloff

    shake.previousPositionOffset.set(
      (Math.random() * 2 - 1) * intensity,
      (Math.random() * 2 - 1) * intensity * 0.6,
      (Math.random() * 2 - 1) * intensity
    )
    shake.previousLookOffset.set(
      (Math.random() * 2 - 1) * intensity * 0.5,
      (Math.random() * 2 - 1) * intensity * 0.5,
      (Math.random() * 2 - 1) * intensity * 0.5
    )

    camera.position.add(shake.previousPositionOffset)
    this.cameraLookAt.add(shake.previousLookOffset)
    camera.lookAt(this.cameraLookAt)
    if (this.orbitControls) {
      this.orbitControls.target.copy(this.cameraLookAt)
      this.orbitControls.update()
    }
  }

  private easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  private registerAnimations() {
    if (!this.pokemonActors.size) return
    const panels = Array.from(this.pokemonActors.entries()).map(([id, actor]) => ({
      id,
      names: actor.animations.map((clip) => clip.name || 'untitled'),
    }))
    this.game.events.emit('pokemon:animations', panels)
  }



  private playAnimation(id: string, name: string) {
    const actor = this.pokemonActors.get(id)
    if (!actor || !actor.animations.length) {
      this.handleMissingDirectAnimation(id, name)
      return undefined
    }

    const clip = this.findClip(actor, name)
    if (!clip) {
      this.handleMissingDirectAnimation(id, name)
      return undefined
    }

    this.playClip(id, actor, clip)
    return clip
  }

  private playClip(
    id: string,
    actor: PokemonActor,
    clip: THREE.AnimationClip,
    fadeDuration: number = 0.2,
    loopIndefinitely: boolean = false
  ) {
   
    const mixer = actor.mixer
    const nextAction = mixer.clipAction(clip)
    const currentAction = this.activeAnimationActions.get(id)
    const restartingSameClip = currentAction === nextAction

    if (restartingSameClip) {
      nextAction.reset().play()
    } else {
      nextAction.reset()
      nextAction.enabled = true
      if (loopIndefinitely) {
        nextAction.setLoop(THREE.LoopRepeat, Infinity)
        nextAction.clampWhenFinished = false
      } else {
        nextAction.setLoop(THREE.LoopOnce, 0)
        nextAction.clampWhenFinished = true
      }

      if (currentAction) {
        nextAction.setEffectiveWeight(1)
        nextAction.play()
        currentAction.crossFadeTo(nextAction, fadeDuration, false)
      } else {
        nextAction.fadeIn(fadeDuration).play()
      }

      this.activeAnimationActions.set(id, nextAction)
    }

    mixer.update(1 / 300)
  }

  private applyCameraBehavior(request: CameraBehaviorRequest) {
    // console.log('[PlaygroundScene] applyCameraBehavior', request.id, request.initiatorId, request.camera.lookAt)
    const camera = this.third.camera as THREE.PerspectiveCamera
    const position = this.vectorFromSpec(request.camera.position, camera.position)
    const lookAt = this.resolveCameraLookAt(request.camera.lookAt)
    const duration = request.camera.duration ?? 0.8
    this.transitionCamera(position, lookAt, duration)
    if (request.id) {
      this.activeBehaviors.set(request.id, {
        initiatorId: request.initiatorId,
        label: request.label,
      })
      this.game.events.emit('pokemon:actionStart', {
        id: request.id,
        initiatorId: request.initiatorId,
        label: request.label,
      })
    }
    const enqueued = this.queueCameraActions(request.afterCameraActions, 100, request.id)
    if (request.id && enqueued === 0) {
      this.completeBehavior(request.id)
    }
  }

  private completeBehavior(behaviorId: string) {
    const metadata = this.activeBehaviors.get(behaviorId)
    if (!metadata) return
    this.activeBehaviors.delete(behaviorId)
    this.behaviorActionCounts.delete(behaviorId)
    this.game.events.emit('pokemon:actionComplete', {
      id: behaviorId,
      initiatorId: metadata.initiatorId,
      label: metadata.label,
    })
  }

  private markBehaviorActionComplete(behaviorId?: string) {
    if (!behaviorId) return
    const remaining = (this.behaviorActionCounts.get(behaviorId) ?? 0) - 1
    if (remaining <= 0) {
      this.completeBehavior(behaviorId)
    } else {
      this.behaviorActionCounts.set(behaviorId, remaining)
    }
  }

  private resolveCameraLookAt(spec?: CameraLookAtSpec) {
    if (!spec) return this.cameraLookAt.clone()
    if (spec.type === 'actor') {
      const actor = this.pokemonActors.get(spec.id)
      if (!actor) return this.cameraLookAt.clone()
      const worldPosition = new THREE.Vector3()
      actor.object.getWorldPosition(worldPosition)
      return worldPosition
    }
    return this.vectorFromSpec(spec.position, this.cameraLookAt)
  }

  private vectorFromSpec(spec: Vector3Spec, fallback?: THREE.Vector3) {
    const base = fallback ?? new THREE.Vector3()
    const x = this.resolveAxisValue(spec.x, base.x)
    const y = this.resolveAxisValue(spec.y, base.y)
    const z = this.resolveAxisValue(spec.z, base.z)
    return new THREE.Vector3(x, y, z)
  }

  private resolveAxisValue(value: AxisValueSpec, current: number) {
    if (value === 'current') return current
    if (typeof value === 'number') return value
    if (typeof value === 'object' && value?.type === 'relative') {
      return current + value.delta
    }
    return current
  }

  private processCameraActions() {
    if (this.cameraActionsProcessing) return
    this.cameraActionsProcessing = true
    while (this.pendingCameraActions.length) {
      const { action, behaviorId } = this.pendingCameraActions.shift()!
      const paused = this.executeCameraAction(action, behaviorId)
      if (paused) {
        this.cameraActionsProcessing = false
        return
      }
      if (action.type !== 'playAnimation') {
        this.markBehaviorActionComplete(behaviorId)
      }
    }
    this.cameraActionsProcessing = false
  }

  private executeCameraAction(action: CameraBehaviorAction, behaviorId?: string) {
    switch (action.type) {
      case 'moveActor':
        this.executeMoveActorAction(action)
        return false
      case 'moveActorAnimated':
        return this.executeMoveActorAnimatedAction(action, behaviorId)
      case 'playAnimation':
        this.executePlayAnimationAction(action, behaviorId)
        return false
      case 'playIdleRandom':
        this.executePlayIdleRandomAction(action)
        return false
      case 'resetActorPosition':
        return this.executeResetActorPositionAction(action, behaviorId)
      case 'freezeActors':
        return this.executeFreezeActorsAction(action)
      case 'shakeCamera':
        this.executeShakeCameraAction(action)
        return false
      case 'resetCamera':
        this.executeResetCameraAction()
        return false
      default:
        return false
    }
  }

  private executeMoveActorAction(action: Extract<CameraBehaviorAction, { type: 'moveActor' }>) {
    const actor = this.pokemonActors.get(action.id)
    if (!actor) return
    const nextPosition = this.vectorFromSpec(action.position, actor.object.position)
    actor.object.position.copy(nextPosition)
    actor.bounds.update()
  }

  private executeMoveActorAnimatedAction(
    action: Extract<CameraBehaviorAction, { type: 'moveActorAnimated' }>,
    behaviorId?: string
  ): boolean {
    const actor = this.pokemonActors.get(action.id)
    if (!actor) return false
    const targetPosition = this.vectorFromSpec(action.position, actor.object.position)
    const startPosition = actor.object.position.clone()
    const duration = Math.max(0, action.duration ?? 400)

    if (duration === 0) {
      actor.object.position.copy(targetPosition)
      actor.bounds.update()
      return false
    }

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const t = Number(tween.getValue())
        actor.object.position.set(
          THREE.MathUtils.lerp(startPosition.x, targetPosition.x, t),
          THREE.MathUtils.lerp(startPosition.y, targetPosition.y, t),
          THREE.MathUtils.lerp(startPosition.z, targetPosition.z, t)
        )
        actor.bounds.update()
      },
      onComplete: () => {
        actor.object.position.copy(targetPosition)
        actor.bounds.update()
        this.markBehaviorActionComplete(behaviorId)
        this.processCameraActions()
      },
    })

    return true
  }

  private executePlayAnimationAction(
    action: Extract<CameraBehaviorAction, { type: 'playAnimation' }>,
    behaviorId?: string
  ) {
    const actor = this.pokemonActors.get(action.id)
    const clip = actor ? this.findClip(actor, action.animation) : undefined

    if (!actor || !clip) {
      this.handleMissingAnimation(action, behaviorId)
      return
    }

    this.playClip(action.id, actor, clip)

    const clipDurationMs = clip.duration
    if (action.midActions?.length) {
      action.midActions.forEach((mid) => {
        const delayFromClip =
          clipDurationMs !== undefined && mid.at !== undefined
            ? mid.at * clipDurationMs * 1000
            : undefined
        const delayMs = mid.delayMs ?? delayFromClip ?? 0
        this.queueCameraActions(mid.actions, delayMs, behaviorId)
      })
    }

    const followUpActions = action.onComplete ?? []
    if (behaviorId || followUpActions.length) {
      this.animationFollowUps.set(action.id, {
        clipName: action.animation,
        actions: followUpActions,
        behaviorId,
      })
    } else {
      this.animationFollowUps.delete(action.id)
    }
  }

  private handleMissingAnimation(
    action: Extract<CameraBehaviorAction, { type: 'playAnimation' }>,
    behaviorId?: string
  ) {
    console.warn(`[PlaygroundScene] Missing animation "${action.animation}" for actor ${action.id}`)
    if (action.midActions?.length) {
      action.midActions.forEach((mid) => {
        const delayMs = mid.delayMs ?? 0
        if (mid.actions?.length) {
          this.queueCameraActions(mid.actions, delayMs, behaviorId)
        }
      })
    }
    if (action.onComplete?.length) {
      this.queueCameraActions(action.onComplete, 0, behaviorId)
    }
    this.animationFollowUps.delete(action.id)
    if (behaviorId) {
      this.markBehaviorActionComplete(behaviorId)
    }
  }

  private handleMissingDirectAnimation(id: string, name: string) {
    console.warn(`[PlaygroundScene] Missing direct animation "${name}" for actor ${id}`)
    const pending = this.pendingSimpleActions.get(id)
    if (!pending) return
    this.pendingSimpleActions.delete(id)
    this.game.events.emit('pokemon:actionComplete', {
      id: pending.actionId,
      initiatorId: pending.initiatorId,
      label: pending.label,
    })
  }

  private executePlayIdleRandomAction(
    action: Extract<CameraBehaviorAction, { type: 'playIdleRandom' }>
  ) {
    this.playDefaultAnimation(action.id)
  }

  private executeResetActorPositionAction(
    action: Extract<CameraBehaviorAction, { type: 'resetActorPosition' }>,
    behaviorId?: string
  ) {
    const actor = this.pokemonActors.get(action.id)
    const home = this.actorHomePositions.get(action.id)
    if (!actor || !home) return false
    const duration = Math.max(0, action.duration ?? 0)

    if (duration === 0) {
      actor.object.position.copy(home)
      actor.bounds.update()
      return false
    }

    const startPosition = actor.object.position.clone()
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const t = Number(tween.getValue())
        actor.object.position.set(
          THREE.MathUtils.lerp(startPosition.x, home.x, t),
          THREE.MathUtils.lerp(startPosition.y, home.y, t),
          THREE.MathUtils.lerp(startPosition.z, home.z, t)
        )
        actor.bounds.update()
      },
      onComplete: () => {
        actor.object.position.copy(home)
        actor.bounds.update()
        this.markBehaviorActionComplete(behaviorId)
        this.processCameraActions()
      },
    })

    return true
  }

  private executeFreezeActorsAction(action: Extract<CameraBehaviorAction, { type: 'freezeActors' }>) {
    const duration = Math.max(0, action.duration)
    if (!action.ids.length || duration === 0) return false

    action.ids.forEach((id) => this.freezeActor(id))

    this.time.delayedCall(duration, () => {
      action.ids.forEach((id) => this.unfreezeActor(id))
    })

    return false
  }

  private executeShakeCameraAction(action: Extract<CameraBehaviorAction, { type: 'shakeCamera' }>) {
    this.startCameraShake(action.intensity, action.duration)
  }

  private executeResetCameraAction() {
    this.transitionCamera(this.overviewCameraPosition, this.overviewCameraLookAt, 1)
  }


  private triggerAnimationFollowUps(actorId: string, clipName?: string) {
    if (!clipName) return false
    const followUp = this.animationFollowUps.get(actorId)
    if (!followUp) return false
    const storedName = followUp.clipName
    if (storedName && !this.clipNameMatchesTarget(clipName, storedName)) return false
    this.animationFollowUps.delete(actorId)
    if (followUp.actions.length) {
      this.queueCameraActions(followUp.actions, 0, followUp.behaviorId)
    }
    if (followUp.behaviorId) {
      this.markBehaviorActionComplete(followUp.behaviorId)
    }
    return followUp.actions.length > 0
  }

  private queueCameraActions(
    actions?: CameraBehaviorAction[],
    delayMs: number = 0,
    behaviorId?: string
  ): number {
    if (!actions || actions.length === 0) return 0
    const enqueue = () => {
      actions.forEach((action) => {
        if (behaviorId) {
          const current = this.behaviorActionCounts.get(behaviorId) ?? 0
          this.behaviorActionCounts.set(behaviorId, current + 1)
        }
        this.pendingCameraActions.push({ action, behaviorId })
      })
      this.processCameraActions()
    }
    if (delayMs <= 0) {
      enqueue()
    } else {
      this.time.delayedCall(delayMs, enqueue)
    }
    return actions.length
  }

  private freezeActor(id: string) {
    const actor = this.pokemonActors.get(id)
    if (!actor) return
    const count = this.actorFreezeCounts.get(id) ?? 0
    if (count === 0) {
      actor.mixer.timeScale = 0
    }
    this.actorFreezeCounts.set(id, count + 1)
  }

  private unfreezeActor(id: string) {
    const actor = this.pokemonActors.get(id)
    if (!actor) return
    const count = this.actorFreezeCounts.get(id)
    if (!count) return
    if (count <= 1) {
      this.actorFreezeCounts.delete(id)
      actor.mixer.timeScale = 1
    } else {
      this.actorFreezeCounts.set(id, count - 1)
    }
  }

  private startCameraShake(intensity: number, durationMs: number) {
    this.stopCameraShake()
    if (durationMs <= 0 || intensity <= 0) return
    const shake = this.cameraShake
    shake.active = true
    shake.duration = durationMs / 1000
    shake.elapsed = 0
    shake.intensity = intensity
    shake.previousPositionOffset.set(0, 0, 0)
    shake.previousLookOffset.set(0, 0, 0)
  }

  private stopCameraShake() {
    const shake = this.cameraShake
    if (!shake.active && shake.previousPositionOffset.lengthSq() === 0 && shake.previousLookOffset.lengthSq() === 0)
      return

    const camera = this.third.camera as THREE.PerspectiveCamera
    camera.position.sub(shake.previousPositionOffset)
    this.cameraLookAt.sub(shake.previousLookOffset)
    if (this.orbitControls) {
      this.orbitControls.target.sub(shake.previousLookOffset)
      this.orbitControls.update()
    } else {
      camera.lookAt(this.cameraLookAt)
    }

    shake.active = false
    shake.duration = 0
    shake.elapsed = 0
    shake.intensity = 0
    shake.previousPositionOffset.set(0, 0, 0)
    shake.previousLookOffset.set(0, 0, 0)
  }


  private findClip(actor: PokemonActor, name: string) {
    if (!name) return undefined
    const targetVariants = this.buildNameVariants(name)
    if (!targetVariants.length) return undefined
    const underscoreVariants = targetVariants.map((variant) => `_${variant}`)

    const matchExact = actor.animations.find((clip) => {
      const variants = this.buildNameVariants(clip.name)
      return variants.some((value) => targetVariants.includes(value))
    })
    if (matchExact) return matchExact

    const matchEndsWithUnderscore = actor.animations.find((clip) => {
      const variants = this.buildNameVariants(clip.name)
      return variants.some((value) =>
        underscoreVariants.some((suffix) => value.endsWith(suffix))
      )
    })
    if (matchEndsWithUnderscore) return matchEndsWithUnderscore

    return actor.animations.find((clip) => {
      const variants = this.buildNameVariants(clip.name)
      return variants.some((value) => targetVariants.some((suffix) => value.endsWith(suffix)))
    })
  }

  private buildNameVariants(value?: string | null) {
    if (!value) return [] as string[]
    const lower = value.toLowerCase()
    const variants = new Set<string>([lower])
    if (lower.endsWith('.tranm')) {
      variants.add(lower.slice(0, -'.tranm'.length))
    }
    return Array.from(variants).filter(Boolean)
  }

  private clipNameMatchesTarget(clipName?: string, targetName?: string) {
    if (!clipName || !targetName) return false
    const clipVariants = this.buildNameVariants(clipName)
    const targetVariants = this.buildNameVariants(targetName)
    if (!clipVariants.length || !targetVariants.length) return false

    if (clipVariants.some((value) => targetVariants.includes(value))) {
      return true
    }

    const underscoreTargets = targetVariants.map((variant) => `_${variant}`)
    if (
      clipVariants.some((value) =>
        underscoreTargets.some((suffix) => value.endsWith(suffix))
      )
    ) {
      return true
    }

    return clipVariants.some((value) =>
      targetVariants.some((suffix) => value.endsWith(suffix))
    )
  }

  private scheduleWhiteoutAtMidAnimation(
    slot: PokemonSlot,
    clip: THREE.AnimationClip,
    options?: { respawnAfter?: boolean; withParticles?: boolean }
  ) {
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) return
    const delayMs = clip.duration * 0.8 * 1000
    this.time.delayedCall(delayMs, () => {
      this.handleWhiteoutRequest({
        slot,
        respawnAfter: options?.respawnAfter ?? false,
        withParticles: options?.withParticles ?? true,
      })
    })
  }

  private preloadRemainingModels() {
    const allSpecies: PokemonSpecies[] = Array.from(
      new Set([...AVAILABLE_SPECIES_BY_SLOT.p1, ...AVAILABLE_SPECIES_BY_SLOT.p2])
    ) as PokemonSpecies[]
    const alreadyLoaded = [
      this.currentSpeciesBySlot.p1,
      this.currentSpeciesBySlot.p2
    ]

    const toPreload = allSpecies.filter(
      species => !alreadyLoaded.includes(species)
    )

    console.log(`🔄 Precargando ${toPreload.length} modelos en segundo plano...`)

    toPreload.forEach(species => {
      this.loadModel(species).then(() => {
        console.log(`✅ Modelo ${species} precargado`)
      }).catch(err => {
        console.error(`❌ Error precargando ${species}:`, err)
      })
    })
  }

}


