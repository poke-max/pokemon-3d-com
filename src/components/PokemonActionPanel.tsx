import { PokemonKnownAnimations } from './PokemonKnownAnimations'
import { PokemonSwapPanel } from './PokemonSwapPanel'
import { PokemonStagePanel } from './PokemonStagePanel'
import type { CameraBehaviorRequest } from '../types/cameraBehaviors'
import type { PokemonSlot } from '../phaser/PlaygroundScene'
import type { PokemonSelection } from '../phaser/PlaygroundScene'
import type { PokemonBattleState } from '../types/pokemonStates'
import type { StatId } from '../data/speciesMeta'
import './PokemonActionPanel.css'
import type { WeatherTriggerRequest } from '../types/weather'

type PokemonActionPanelProps = {
  availablePokemon: string[]
  teams: Record<PokemonSlot, PokemonSelection[]>
  knownAnimationsById?: Record<string, string[]>
  onPlayAnimation: (
    actorId: string,
    animationName: string,
    options?: { actionId?: string; actionLabel?: string }
  ) => void
  onCameraBehavior?: (request: CameraBehaviorRequest) => void
  onSwapPokemon?: (slot: PokemonSlot, selection: PokemonSelection) => void
  onTestWhiteout?: (slot: PokemonSlot, options?: { respawnAfter?: boolean; withParticles?: boolean }) => void
  onSetBattleState?: (slot: PokemonSlot, state: PokemonBattleState) => void
  onLogEvent?: (message: string) => void
  battleStates?: Record<PokemonSlot, PokemonBattleState>
  onApplyHpDelta?: (
    slot: PokemonSlot,
    delta: number,
    options?: { label?: string; skipDamageAnimation?: boolean; durationMs?: number }
  ) => void
  onAdjustStage?: (slot: PokemonSlot, stat: StatId, delta: number) => void
  stageValues?: Record<PokemonSlot, Partial<Record<StatId, number>>>
  weatherActive?: boolean
  onTriggerWeather?: (payload: WeatherTriggerRequest) => void
}

const isPokemonSlotId = (value: string): value is PokemonSlot => value === 'p1' || value === 'p2'

type PokemonHpTestPanelProps = Pick<PokemonActionPanelProps, 'onApplyHpDelta'>

const PokemonHpTestPanel = ({ onApplyHpDelta }: PokemonHpTestPanelProps) => {
  if (!onApplyHpDelta) return null

  const applyDelta = (slot: PokemonSlot, delta: number) => {
    const label = delta < 0 ? 'Prueba Daño' : 'Prueba Curacion'
    onApplyHpDelta(slot, delta, { label })
  }

  return (
    <div className="hp-test-panel">
      <span className="hp-test-panel__title">Prueba de PS</span>
      <div className="hp-test-panel__slots">
        {(['p1', 'p2'] as PokemonSlot[]).map((slot) => (
          <div key={slot} className="hp-test-panel__slot">
            <span className="hp-test-panel__slot-label">{slot.toUpperCase()}</span>
            <div className="hp-test-panel__slot-buttons">
              <button type="button" onClick={() => applyDelta(slot, -25)}>
                Daño -25
              </button>
              <button type="button" onClick={() => applyDelta(slot, 25)}>
                Curar +25
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PokemonActionPanel({
  availablePokemon,
  teams,
  knownAnimationsById,
  onPlayAnimation,
  onCameraBehavior,
  onSwapPokemon,
  onTestWhiteout,
  onSetBattleState,
  onLogEvent,
  battleStates,
  onApplyHpDelta,
  onAdjustStage,
  stageValues,
  weatherActive,
  onTriggerWeather,
}: PokemonActionPanelProps) {
  if (!availablePokemon.length) return null

  const handleWhiteout = onTestWhiteout
    ? (
        actorId: string,
        options?: { respawnAfter?: boolean; withParticles?: boolean }
      ) => {
        if (!isPokemonSlotId(actorId)) return
        onTestWhiteout(actorId, options)
      }
    : undefined

  return (
    <section className="animation-panel action-panel">
      <span>Animaciones conocidas</span>
      <div className="action-panel__body">
        <PokemonKnownAnimations
          availablePokemon={availablePokemon}
          knownAnimationsById={knownAnimationsById}
          onPlayAnimation={onPlayAnimation}
          onCameraBehavior={onCameraBehavior}
          onWhiteout={handleWhiteout}
          onSetBattleState={onSetBattleState}
          onLogEvent={onLogEvent}
          battleStates={battleStates}
          weatherActive={weatherActive}
          onTriggerWeather={onTriggerWeather}
        />
        <PokemonSwapPanel
          teams={teams}
          onSwapPokemon={onSwapPokemon}
          onTestWhiteout={onTestWhiteout}
          disabledSlots={(() => {
            const disabled: Record<PokemonSlot, boolean> = { p1: false, p2: false }
            ;(['p1', 'p2'] as PokemonSlot[]).forEach((slot) => {
              const state = battleStates?.[slot]
              disabled[slot] =
                state === 'contactAttack' ||
                state === 'rangedAttack' ||
                state === 'statusAttack' ||
                state === 'swap'
            })
            return disabled
          })()}
        />
        <PokemonHpTestPanel onApplyHpDelta={onApplyHpDelta} />
        <PokemonStagePanel stages={stageValues ?? { p1: {}, p2: {} }} onAdjustStage={onAdjustStage} />
      </div>
    </section>
  )
}
