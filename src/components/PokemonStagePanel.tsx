import type { PokemonSlot } from '../phaser/PlaygroundScene'
import { STAT_LABELS, type StatId } from '../data/speciesMeta'

type PokemonStagePanelProps = {
  stages: Record<PokemonSlot, Partial<Record<StatId, number>>>
  onAdjustStage?: (slot: PokemonSlot, stat: StatId, delta: number) => void
}

const formatStage = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const ALL_STATS = Object.keys(STAT_LABELS) as StatId[]
const ALL_SLOTS: PokemonSlot[] = ['p1', 'p2']

export function PokemonStagePanel({ stages, onAdjustStage }: PokemonStagePanelProps) {
  return (
    <div className="stage-panel">
      <span className="stage-panel__title">Modificadores de estadisticas</span>
      <div className="stage-panel__body">
        {ALL_SLOTS.map((slot) => (
          <div key={slot} className="stage-panel__slot">
            <span className="stage-panel__slot-label">{slot.toUpperCase()}</span>
            <div className="stage-panel__stats">
              {ALL_STATS.map((statId) => {
                const value = stages[slot]?.[statId] ?? 0
                return (
                  <div key={`${slot}-${statId}`} className="stage-panel__row">
                    <span className="stage-panel__stat">{STAT_LABELS[statId]}</span>
                    <div className="stage-panel__controls">
                      <button type="button" onClick={() => onAdjustStage?.(slot, statId, -1)}>
                        -
                      </button>
                      <span className="stage-panel__value">{formatStage(value)}</span>
                      <button type="button" onClick={() => onAdjustStage?.(slot, statId, 1)}>
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
