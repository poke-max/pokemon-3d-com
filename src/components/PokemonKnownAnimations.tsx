import { useEffect, useMemo, useState } from 'react'
import type { CameraBehaviorRequest } from '../types/cameraBehaviors'
import type { PokemonSlot } from '../phaser/PlaygroundScene'
import type { PokemonBattleState } from '../types/pokemonStates'
import type { WeatherTriggerRequest } from '../types/weather'

type BehaviorContext = {
  selectedPokemon: string
  knownAnimationsById?: Record<string, string[]>
  onPlayAnimation: PokemonKnownAnimationsProps['onPlayAnimation']
  onCameraBehavior?: PokemonKnownAnimationsProps['onCameraBehavior']
  onWhiteout?: PokemonKnownAnimationsProps['onWhiteout']
  onSetBattleState?: PokemonKnownAnimationsProps['onSetBattleState']
  onLogEvent?: PokemonKnownAnimationsProps['onLogEvent']
  battleStates?: PokemonKnownAnimationsProps['battleStates']
  triggerWeather?: PokemonKnownAnimationsProps['onTriggerWeather']
  weatherActive?: boolean
}

type PokemonAnimationBehavior = {
  id: string
  label: string
  run: (context: BehaviorContext) => void
  isDisabled?: (context: BehaviorContext) => boolean
  description?: string
}

type AnimationVariant = {
  id: string
  animation: string
}

const CONTACT_ATTACK_DAMAGE_REACTION = {
  at: 0.33,
  animation: 'pm1012_00_00_00500_damage01.tranm',
} as const

const CONTACT_ATTACK_P1_VARIANTS: readonly AnimationVariant[] = [
  {
    id: 'contact-attack-p1:attack01',
    animation: '_attack01.tranm',
  },
  {
    id: 'contact-attack-p1:attack02',
    animation: '_attack02.tranm',
  },
] as const

const CONTACT_ATTACK_P2_VARIANTS: readonly AnimationVariant[] = [
  {
    id: 'contact-attack-p2:attack01',
    animation: '_attack01.tranm',
  },
  {
    id: 'contact-attack-p2:attack02',
    animation: '_attack02.tranm',
  },
] as const

const RANGED_ATTACK_VARIANTS: readonly AnimationVariant[] = [
  {
    id: 'ranged-attack:rangeattack01',
    animation: 'rangeattack01.tranm',
  },
  {
    id: 'ranged-attack:rangeattack02',
    animation: 'rangeattack02_start.tranm',
  },
  {
    id: 'ranged-attack:directionattack01',
    animation: 'directionattack01.tranm',
  },
] as const

const RANGED_CAMERA_CONFIG: Record<
  PokemonSlot,
  { position: CameraBehaviorRequest['camera']['position']; duration: number }
> = {
  p1: {
    position: { x: -1.15, y: 0.92, z: 2.6 },
    duration: 0.65,
  },
  p2: {
    position: { x: 1.15, y: 0.92, z: -2.6 },
    duration: 0.65,
  },
}

function isPokemonSlot(id: string): id is PokemonSlot {
  return id === 'p1' || id === 'p2'
}

const relativeAxis = (delta: number) => ({
  type: 'relative' as const,
  delta,
})

const buildAnimationNameVariants = (value?: string | null) => {
  if (!value) return [] as string[]
  const lower = value.toLowerCase()
  const variants = new Set<string>([lower])
  if (lower.endsWith('.tranm')) {
    variants.add(lower.slice(0, -'.tranm'.length))
  }
  return Array.from(variants).filter(Boolean)
}

const clipMatchesAnimation = (clipName: string, targetVariants: string[]) => {
  if (!clipName || !targetVariants.length) return false
  const clipVariants = buildAnimationNameVariants(clipName)
  if (!clipVariants.length) return false

  if (clipVariants.some((value) => targetVariants.includes(value))) {
    return true
  }

  const underscoreVariants = targetVariants.map((variant) => `_${variant}`)
  if (
    clipVariants.some((value) =>
      underscoreVariants.some((suffix) => value.endsWith(suffix))
    )
  ) {
    return true
  }

  return clipVariants.some((value) =>
    targetVariants.some((suffix) => value.endsWith(suffix))
  )
}

const doesPokemonHaveAnimation = (
  pokemonId: string,
  animationName: string,
  knownAnimationsById?: Record<string, string[]>
) => {
  if (!pokemonId || !animationName) return false
  const knownAnimations = knownAnimationsById?.[pokemonId]
  if (!knownAnimations?.length) return false
  const targetVariants = buildAnimationNameVariants(animationName)
  if (!targetVariants.length) return false
  return knownAnimations.some((clipName) =>
    clipMatchesAnimation(clipName, targetVariants)
  )
}

const selectAnimationVariant = (
  variants: readonly AnimationVariant[],
  pokemonId: string,
  knownAnimationsById?: Record<string, string[]>
): AnimationVariant => {
  if (!variants.length) {
    throw new Error('selectAnimationVariant requires at least one variant')
  }
  const available =
    knownAnimationsById && pokemonId
      ? variants.find((variant) =>
          doesPokemonHaveAnimation(pokemonId, variant.animation, knownAnimationsById)
        )
      : undefined
  return available ?? variants[0]
}


export const buildSelfStatusCameraRequest = (
  slot: PokemonSlot,
  label: string
): CameraBehaviorRequest => {
  const forwardOffset = slot === 'p1' ? 2 : -2
  return {
    id: `status-self:${slot}:${Date.now()}`,
    initiatorId: slot,
    label,
    camera: {
      position: {
        x: 0,
        y: 'current',
        z: forwardOffset,
      },
      lookAt: { type: 'actor', id: slot },
      duration: 0.55,
    },
    afterCameraActions: [
      {
        type: 'playAnimation',
        id: slot,
        animation: 'roar01.tranm',
        midActions: [
          {
            at: 0.5,
            actions: [{ type: 'resetCamera' }],
          },
        ],
        onComplete: [{ type: 'playIdleRandom', id: slot }],
      },
    ],
  }
}

const BASE_BEHAVIORS: PokemonAnimationBehavior[] = [
  {
    id: 'idle-random',
    label: 'Idle (random)',
    description: 'Elige aleatoriamente entre los dos loops idle conocidos.',
    run: ({ selectedPokemon, onPlayAnimation, onSetBattleState, onLogEvent }) => {
      if (!selectedPokemon) return
      const animationPool = [
        'defaultwait01_loop.tranm',
        'battlewait01_loop.tranm',
      ] as const
      const animationName =
        animationPool[Math.floor(Math.random() * animationPool.length)]
      onPlayAnimation(selectedPokemon, animationName)
      if (isPokemonSlot(selectedPokemon)) {
        onSetBattleState?.(selectedPokemon, null)
      }
      onLogEvent?.(
        `${selectedPokemon.toUpperCase()} -> Idle (${animationName.replace('.tranm', '')})`
      )
    },
    isDisabled: ({ selectedPokemon }) => !selectedPokemon,
  },
  {
    id: 'status-self-camera',
    label: 'Status propio + camara',
    description: 'Coloca la camara al frente del Pokemon seleccionado y reproduce una animacion de estado.',
    run: ({ selectedPokemon, onCameraBehavior, onSetBattleState, onLogEvent }) => {
      if (!onCameraBehavior || !isPokemonSlot(selectedPokemon)) return
      const request = buildSelfStatusCameraRequest(
        selectedPokemon,
        `Status Propio ${selectedPokemon.toUpperCase()}`
      )
      onSetBattleState?.(selectedPokemon, 'statusAttack')
      onCameraBehavior(request)
      onLogEvent?.(`${selectedPokemon.toUpperCase()} ejecuta movimiento de estado con camara enfocada`)
    },
    isDisabled: ({ selectedPokemon, onCameraBehavior }) =>
      !onCameraBehavior || !isPokemonSlot(selectedPokemon),
  },
  {
    id: 'weather-rain',
    label: 'Clima: Lluvia',
    description: 'Activa lluvia continua sobre todo el campo (hasta detenerla).',
    run: ({ triggerWeather }) => {
      triggerWeather?.({ type: 'rain', label: 'Clima: Lluvia', action: 'start' })
    },
    isDisabled: ({ triggerWeather, weatherActive }) =>
      !triggerWeather || Boolean(weatherActive),
  },
  {
    id: 'weather-snowscape',
    label: 'Clima: Snowscape',
    description: 'Invoca una ventisca de granizos cayendo recto sobre el campo.',
    run: ({ triggerWeather }) => {
      triggerWeather?.({ type: 'snowscape', label: 'Clima: Snowscape', action: 'start' })
    },
    isDisabled: ({ triggerWeather, weatherActive }) =>
      !triggerWeather || Boolean(weatherActive),
  },
  {
    id: 'weather-sunnyday',
    label: 'Clima: Soleado',
    description: 'Activa un sol intenso con rayos de luz calidos.',
    run: ({ triggerWeather }) => {
      triggerWeather?.({ type: 'sunnyday', label: 'Clima: Soleado', action: 'start' })
    },
    isDisabled: ({ triggerWeather, weatherActive }) =>
      !triggerWeather || Boolean(weatherActive),
  },
  {
    id: 'weather-sandstorm',
    label: 'Clima: Tormenta de arena',
    description: 'Desata vientos cargados de arena sobre el escenario.',
    run: ({ triggerWeather }) => {
      triggerWeather?.({
        type: 'sandstorm',
        label: 'Clima: Tormenta de Arena',
        action: 'start',
      })
    },
    isDisabled: ({ triggerWeather, weatherActive }) =>
      !triggerWeather || Boolean(weatherActive),
  },
  {
    id: 'weather-deltastream',
    label: 'Clima: Delta Stream',
    description: 'Genera vientos grises y densos cubriendo todo el campo.',
    run: ({ triggerWeather }) => {
      triggerWeather?.({
        type: 'deltastream',
        label: 'Clima: Delta Stream',
        action: 'start',
      })
    },
    isDisabled: ({ triggerWeather, weatherActive }) =>
      !triggerWeather || Boolean(weatherActive),
  },
  {
    id: 'weather-stop',
    label: 'Detener clima',
    description: 'Detiene cualquier clima activo.',
    run: ({ triggerWeather }) => {
      triggerWeather?.({ action: 'stop', label: 'Clima detenido' })
    },
    isDisabled: ({ triggerWeather, weatherActive }) => !triggerWeather || !weatherActive,
  },
  {
    id: 'contact-attack',
    label: 'ContactAttack P1',
    description: 'Activa el ataque de contacto del jugador 1 y enfoca la camara en p2.',
    run: ({
      selectedPokemon,
      knownAnimationsById,
      onCameraBehavior,
      onSetBattleState,
      onLogEvent,
    }) => {
      if (selectedPokemon !== 'p1' || !onCameraBehavior) return
      const variant = selectAnimationVariant(
        CONTACT_ATTACK_P1_VARIANTS,
        selectedPokemon,
        knownAnimationsById
      )

      const request: CameraBehaviorRequest = {
        id: variant.id,
        initiatorId: 'p1',
        label: 'Contact Attack P1',
        camera: {
          position: { x: 'current', y: 'current', z: 'current' },
          lookAt: { type: 'actor', id: 'p2' },
          duration: 0.5,
        },
        afterCameraActions: [
          {
            type: 'playAnimation',
            id: 'p1',
            animation: variant.animation,
            midActions: [
              {
                at: CONTACT_ATTACK_DAMAGE_REACTION.at,
                actions: [
                  {
                    type: 'shakeCamera',
                    duration: 260,
                    intensity: 0.04,
                  },
                  {
                    type: 'freezeActors',
                    ids: ['p1'],
                    duration: 200,
                  },
                ],
              },
              {
                at: 0.6,
                actions: [
                  { type: 'resetActorPosition', id: 'p1', duration: 50 },
                  { type: 'resetCamera' },
                ],
              },
              {
                at: CONTACT_ATTACK_DAMAGE_REACTION.at,
                actions: [
                  {
                    type: 'playAnimation',
                    id: 'p2',
                    animation: 'damage01.tranm',
                    onComplete: [{ type: 'playIdleRandom', id: 'p2' }],
                  },
                ],
              },
              ],
              onComplete: [
                { type: 'playIdleRandom', id: 'p1' },
            ],
          },
       /*    {
            type: 'moveActorAnimated',
            id: 'p1',
            position: { x: 'current', y: 'current', z: 0 },
            duration: 50,
          }, */
        ],
      }
      onCameraBehavior?.(request)
      onSetBattleState?.('p1', 'contactAttack')
      onLogEvent?.(`P1 inicia Contact Attack (${variant.animation.replace('.tranm', '')})`)
    },
    isDisabled: ({ onCameraBehavior, selectedPokemon }) => !onCameraBehavior || selectedPokemon !== 'p1',
  },
  {
    id: 'debilitamiento',
    label: 'Debilitamiento',
    description: 'Reproduce la animacion de debilitamiento y vuelve al idle cuando termina.',
    run: ({ selectedPokemon, onPlayAnimation, onSetBattleState, onLogEvent }) => {
      if (!selectedPokemon) return
      console.log('[Debilitamiento] playing on', selectedPokemon)
      const actionId = `debilitamiento:${selectedPokemon}:${Date.now()}`
      onPlayAnimation(selectedPokemon, 'down01_start.tranm', {
        actionId,
        actionLabel: 'Debilitamiento',
      })
      if (isPokemonSlot(selectedPokemon)) {
        onSetBattleState?.(selectedPokemon, 'debilitado')
      }
      onLogEvent?.(`${selectedPokemon.toUpperCase()} entra en estado Debilitado`)
      // El whiteout ahora lo agenda la escena usando la duracion real del clip.
    },
    isDisabled: ({ selectedPokemon }) => !selectedPokemon,
  },
  {
    id: 'ranged-attack',
    label: 'Ranged Attack',
    description: 'Reproduce la animacion de ataque a distancia.',
    run: ({
      selectedPokemon,
      knownAnimationsById,
      onPlayAnimation,
      onCameraBehavior,
      onSetBattleState,
      onLogEvent,
    }) => {
      if (!selectedPokemon) return
      const variant = selectAnimationVariant(
        RANGED_ATTACK_VARIANTS,
        selectedPokemon,
        knownAnimationsById
      )
      if (isPokemonSlot(selectedPokemon)) {
        onSetBattleState?.(selectedPokemon, 'rangedAttack')
      }
      if (isPokemonSlot(selectedPokemon) && onCameraBehavior) {
        const target: PokemonSlot = selectedPokemon === 'p1' ? 'p2' : 'p1'
        const cameraConfig = RANGED_CAMERA_CONFIG[selectedPokemon]
        const request: CameraBehaviorRequest = {
          id: `${variant.id}:${selectedPokemon}:${Date.now()}`,
          initiatorId: selectedPokemon,
          label: 'Ranged Attack',
          camera: {
            position: cameraConfig.position,
            lookAt: { type: 'actor', id: target },
            duration: cameraConfig.duration,
          },
          afterCameraActions: [
            {
              type: 'playAnimation',
              id: selectedPokemon,
              animation: variant.animation,
              midActions: [
                {
                  at: 0.52,
                  actions: [
                    {
                      type: 'playAnimation',
                      id: target,
                      animation: 'damage02.tranm',
                      onComplete: [{ type: 'playIdleRandom', id: target }],
                    },
                    { type: 'shakeCamera', duration: 220, intensity: 0.025 },
                  ],
                },
              ],
              onComplete: [
                { type: 'playIdleRandom', id: selectedPokemon },
                { type: 'resetCamera' },
              ],
            },
          ],
        }
        onCameraBehavior(request)
      } else {
        const actionId = `ranged-attack:${selectedPokemon}:${Date.now()}`
        onPlayAnimation(selectedPokemon, variant.animation, {
          actionId,
          actionLabel: 'Ranged Attack',
        })
      }
      onLogEvent?.(
        `${selectedPokemon.toUpperCase()} lanza ataque a distancia (${variant.animation.replace('.tranm', '')})`
      )
    },
    isDisabled: ({ selectedPokemon }) => !selectedPokemon,
    
  },
  {
    id: 'contact-attack-p2',
    label: 'ContactAttack P2',
    description: 'Activa el ataque de contacto del jugador 2 y enfoca la camara en p1.',
    run: ({
      selectedPokemon,
      knownAnimationsById,
      onCameraBehavior,
      onSetBattleState,
      onLogEvent,
    }) => {
      if (selectedPokemon !== 'p2' || !onCameraBehavior) return
      console.log('[ContactAttack P2] triggered', selectedPokemon)
      const variant = selectAnimationVariant(
        CONTACT_ATTACK_P2_VARIANTS,
        selectedPokemon,
        knownAnimationsById
      )
      const request: CameraBehaviorRequest = {
        id: variant.id,
        initiatorId: 'p2',
        label: 'Contact Attack P2',
        camera: {
          position: { x: 'current', y: { type: 'relative', delta: 0.2 }, z: { type: 'relative', delta: 4 } },
          lookAt: { type: 'actor', id: 'p1' },
          duration: 1,
        },
        afterCameraActions: [
          {
            type: 'playAnimation',
            id: 'p2',
            animation: variant.animation,
            midActions: [
              {
                at: CONTACT_ATTACK_DAMAGE_REACTION.at,
                actions: [
                  {
                    type: 'shakeCamera',
                    duration: 260,
                    intensity: 0.04,
                  },
                  {
                    type: 'freezeActors',
                    ids: ['p2'],
                    duration: 200,
                  },
                ],
              },
              {
                at: 0.6,
                actions: [
                  { type: 'resetActorPosition', id: 'p2', duration: 50 },
                  { type: 'resetCamera' },
                ],
              },
              {
                at: CONTACT_ATTACK_DAMAGE_REACTION.at,
                actions: [
                  {
                    type: 'playAnimation',
                    id: 'p1',
                    animation: 'damage02.tranm',
                    onComplete: [{ type: 'playIdleRandom', id: 'p1' }],
                  },
                ],
              },
              ],
              onComplete: [
                { type: 'playIdleRandom', id: 'p2' },
            ],
          },
       /*    {
            type: 'moveActorAnimated',
            id: 'p2',
            position: { x: 'current', y: 'current', z: 0 },
            duration: 50,
          }, */
        ],
      }
      onCameraBehavior?.(request)
      onSetBattleState?.('p2', 'contactAttack')
      onLogEvent?.(`P2 inicia Contact Attack (${variant.animation.replace('.tranm', '')})`)
    },
    isDisabled: ({ onCameraBehavior, selectedPokemon }) => !onCameraBehavior || selectedPokemon !== 'p2',
  },
]

const CAMERA_BEHAVIORS: PokemonAnimationBehavior[] = [
  {
    id: 'camera-overview',
    label: 'Camara: Overview',
    description: 'Restaura una vista amplia general del campo.',
    run: ({ onCameraBehavior }) => {
      if (!onCameraBehavior) return
      onCameraBehavior({
        id: `camera:overview:${Date.now()}`,
        initiatorId: 'ui',
        label: 'Camara Overview',
        camera: {
          position: { x: 1.1, y: 0.8, z: 4.74 },
          lookAt: { type: 'point', position: { x: -0.8, y: 0.6, z: 0 } },
          duration: 1.15,
        },
      })
    },
    isDisabled: ({ onCameraBehavior }) => !onCameraBehavior,
  },
  {
    id: 'camera-focus-selected',
    label: 'Camara: Enfocar seleccionado',
    description: 'Acerca la camara al Pokemon seleccionado.',
    run: ({ selectedPokemon, onCameraBehavior }) => {
      if (!onCameraBehavior || !isPokemonSlot(selectedPokemon)) return
      const forwardOffset = selectedPokemon === 'p1' ? -1.2 : 1.2
      const sideOffset = selectedPokemon === 'p1' ? -0.6 : 0.6
      onCameraBehavior({
        id: `camera:focus:${selectedPokemon}:${Date.now()}`,
        initiatorId: selectedPokemon,
        label: `Camara Focus ${selectedPokemon.toUpperCase()}`,
        camera: {
          position: {
            x: relativeAxis(sideOffset),
            y: relativeAxis(0.45),
            z: relativeAxis(forwardOffset),
          },
          lookAt: { type: 'actor', id: selectedPokemon },
          duration: 0.6,
        },
      })
    },
    isDisabled: ({ selectedPokemon, onCameraBehavior }) =>
      !onCameraBehavior || !isPokemonSlot(selectedPokemon),
  },
  {
    id: 'camera-pan-left',
    label: 'Camara: Pan izquierda',
    description: 'Vista lateral desde la izquierda del campo.',
    run: ({ onCameraBehavior }) => {
      if (!onCameraBehavior) return
      onCameraBehavior({
        id: `camera:pan-left:${Date.now()}`,
        initiatorId: 'ui',
        label: 'Camara Pan Izquierda',
        camera: {
          position: { x: -3.5, y: 1.3, z: 2.6 },
          lookAt: { type: 'point', position: { x: 0, y: 1, z: 0 } },
          duration: 0.85,
        },
      })
    },
    isDisabled: ({ onCameraBehavior }) => !onCameraBehavior,
  },
  {
    id: 'camera-pan-right',
    label: 'Camara: Pan derecha',
    description: 'Vista lateral desde la derecha del campo.',
    run: ({ onCameraBehavior }) => {
      if (!onCameraBehavior) return
      onCameraBehavior({
        id: `camera:pan-right:${Date.now()}`,
        initiatorId: 'ui',
        label: 'Camara Pan Derecha',
        camera: {
          position: { x: 3.5, y: 1.3, z: -2.6 },
          lookAt: { type: 'point', position: { x: 0, y: 1, z: 0 } },
          duration: 0.85,
        },
      })
    },
    isDisabled: ({ onCameraBehavior }) => !onCameraBehavior,
  },
]

const BEHAVIORS: PokemonAnimationBehavior[] = [...BASE_BEHAVIORS, ...CAMERA_BEHAVIORS]

type PokemonKnownAnimationsProps = {
  availablePokemon: string[]
  knownAnimationsById?: Record<string, string[]>
  onPlayAnimation: (
    actorId: string,
    animationName: string,
    options?: { actionId?: string; actionLabel?: string }
  ) => void
  onCameraBehavior?: (request: CameraBehaviorRequest) => void
  onWhiteout?: (
    actorId: string,
    options?: { respawnAfter?: boolean; withParticles?: boolean }
  ) => void
  onSetBattleState?: (slot: PokemonSlot, state: PokemonBattleState) => void
  onLogEvent?: (message: string) => void
  battleStates?: Record<PokemonSlot, PokemonBattleState>
  weatherActive?: boolean
  onTriggerWeather?: (payload: WeatherTriggerRequest) => void
}

export function PokemonKnownAnimations({
  availablePokemon,
  knownAnimationsById,
  onPlayAnimation,
  onCameraBehavior,
  onWhiteout,
  onSetBattleState,
  onLogEvent,
  battleStates,
  weatherActive,
  onTriggerWeather,
}: PokemonKnownAnimationsProps) {
  const [selectedPokemon, setSelectedPokemon] = useState(() => availablePokemon[0] ?? '')

  useEffect(() => {
    if (!availablePokemon.length) {
      setSelectedPokemon('')
      return
    }

    setSelectedPokemon((current) =>
      current && availablePokemon.includes(current) ? current : availablePokemon[0]
    )
  }, [availablePokemon])

  const pokemonOptions = useMemo(() => {
    return availablePokemon.map((id) => ({
      id,
      label: id.toUpperCase(),
    }))
  }, [availablePokemon])

  if (!availablePokemon.length) return null
  const selectedState =
    isPokemonSlot(selectedPokemon) ? battleStates?.[selectedPokemon] : undefined
  const isDebilitated = selectedState === 'debilitado'
  const isSwapping = selectedState === 'swap'

  return (
    <div className="animation-library">
      <label className="action-panel__target">
        <span>Controlar Pokemon</span>
        <select value={selectedPokemon} onChange={(event) => setSelectedPokemon(event.target.value)}>
          {pokemonOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {isDebilitated && (
        <p className="game-hint">
          Este Pokemon esta debilitado. Cambia de Pokemon para continuar.
        </p>
      )}
      <div className="animation-list">
        {BEHAVIORS.map((behavior) => {
          const context: BehaviorContext = {
            selectedPokemon,
            knownAnimationsById,
            onPlayAnimation,
            onCameraBehavior,
            onWhiteout,
            onSetBattleState,
            onLogEvent,
            battleStates,
            triggerWeather: onTriggerWeather,
            weatherActive,
          }
          const disabled = behavior.isDisabled?.(context) ?? false
          const globallyDisabled = isDebilitated || isSwapping
          return (
            <button
              key={behavior.id}
              type="button"
              disabled={disabled || globallyDisabled}
              title={behavior.description}
              onClick={() => behavior.run(context)}
            >
              {behavior.label}
            </button>
          )
        })}
      </div>

    </div>
  )
}
