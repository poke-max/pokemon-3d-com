import type { PokemonSlot, PokemonSelection } from '../phaser/PlaygroundScene'

type PokemonSwapPanelProps = {
  teams: Record<PokemonSlot, PokemonSelection[]>
  onSwapPokemon?: (slot: PokemonSlot, selection: PokemonSelection) => void
  disabledSlots?: Record<PokemonSlot, boolean>
  activeSelection?: Record<PokemonSlot, PokemonSelection | null>
  onTestWhiteout?: (slot: PokemonSlot, options?: { respawnAfter?: boolean; withParticles?: boolean }) => void
}

const SLOT_OPTIONS: PokemonSlot[] = ['p1', 'p2']

export function PokemonSwapPanel({
  teams,
  onSwapPokemon,
  onTestWhiteout,
  disabledSlots,
  activeSelection,
}: PokemonSwapPanelProps) {
  if (!onSwapPokemon && !onTestWhiteout) return null

  const handleSwap = (slot: PokemonSlot, selection: PokemonSelection) => {
    onSwapPokemon?.(slot, selection)
  }
  const handleWhiteout = (slot: PokemonSlot) => {
    onTestWhiteout?.(slot, { respawnAfter: true, withParticles: true })
  }

  return (
    <div className="action-panel__swap">
      <span>Swap Pokemon</span>
      <div className="swap-grid">
        {SLOT_OPTIONS.map((slot) => (
          <div key={slot} className="swap-row">
            <label>{slot.toUpperCase()}</label>
            <div className="swap-buttons">
              {teams[slot].map((selection: PokemonSelection, index: number) => (
                <button
                  key={`${selection.selectionId ?? selection.id}-${index}`}
                  type="button"
                  onClick={() => handleSwap(slot, selection)}
                  disabled={
                    !onSwapPokemon ||
                    disabledSlots?.[slot] ||
                    !!activeSelection?.[slot] &&
                      ((activeSelection[slot]?.selectionId &&
                        activeSelection[slot]?.selectionId === selection.selectionId) ||
                        (!activeSelection[slot]?.selectionId &&
                          !selection.selectionId &&
                          activeSelection[slot]?.id === selection.id &&
                          activeSelection[slot]?.isRare === selection.isRare))
                  }
                >
                  {selection.nickname ? selection.nickname : selection.id}
                </button>
              ))}
              {onTestWhiteout && (
                <button type="button" onClick={() => handleWhiteout(slot)}>
                  Fade Test
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
