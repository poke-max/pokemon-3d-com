import { useState } from 'react'
import { GiCrossedSwords, GiFireBreath, GiRapidshareArrow, GiHealing, GiSwapBag } from 'react-icons/gi'
import { FaLeaf, FaMoon, FaStar, FaFire, FaGhost, FaMountain, FaDragon, FaBolt, FaBug, FaCircle } from 'react-icons/fa'
import type { IconType } from 'react-icons'
import { MOVESET_BY_SPECIES } from '../phaser/PlaygroundScene'
import type { PokemonSlot, PokemonSelection } from '../phaser/PlaygroundScene'
import { Moves } from '../data/moves'
import './AttackPanel.css'

type AttackPanelProps = {
  onSwap?: (slot: PokemonSlot, selection: PokemonSelection) => void
  teamOptions: Record<PokemonSlot, PokemonSelection[]>
  activeSelection?: Record<PokemonSlot, PokemonSelection | null>
  onAttack?: (
    payload: {
      slot: PokemonSlot
      moveName: string
      animationType: 'contact' | 'ranged' | 'status'
      moveTarget?: string
    }
  ) => void
  disabledSlots?: Record<PokemonSlot, boolean>
  hidden?: boolean
}

type AttackSlotId = 'top' | 'right' | 'left' | 'bottom'

const TYPE_COLORS: Record<string, string> = {
  Grass: '#63bb5b',
  Dark: '#705746',
  Fairy: '#ee99ac',
  Fire: '#ff9c54',
  Ghost: '#705898',
  Ground: '#e2bf65',
  Normal: '#a8a77a',
  Dragon: '#7038f8',
  Electric: '#f7d02c',
  Bug: '#a8b820',
  Fighting: '#c22e28',
  Water: '#4d90f0',
  Steel: '#8f8fa1',
  Rock: '#b6a136',
  Psychic: '#f95587',
  Poison: '#a33ea1',
  Ice: '#51c4e7',
  Flying: '#a98ff3',
  Unknown: '#8a8a8a',
}

const TYPE_ICONS: Partial<Record<string, IconType>> = {
  Grass: FaLeaf,
  Dark: FaMoon,
  Fairy: FaStar,
  Fire: FaFire,
  Ghost: FaGhost,
  Ground: FaMountain,
  Normal: FaCircle,
  Dragon: FaDragon,
  Electric: FaBolt,
  Bug: FaBug,
  Fighting: GiCrossedSwords,
  Water: FaCircle,
  Steel: FaCircle,
  Rock: FaMountain,
  Psychic: FaStar,
  Poison: FaMoon,
  Ice: FaCircle,
  Flying: FaCircle,
  Unknown: FaCircle,
}

const POSITION_CONFIG = [
  { id: 'top' as const, Icon: GiCrossedSwords, fallbackLabel: 'Attack 1', fallbackColor: '#6986e7' },
  { id: 'right' as const, Icon: GiHealing, fallbackLabel: 'Attack 2', fallbackColor: '#6d7c86' },
  { id: 'left' as const, Icon: GiRapidshareArrow, fallbackLabel: 'Attack 3', fallbackColor: '#4c64d6' },
  { id: 'bottom' as const, Icon: GiFireBreath, fallbackLabel: 'Attack 4', fallbackColor: '#d4752f' },
]

const resolveMoveData = (moveId?: string) => {
  if (!moveId) return undefined
  return Moves[moveId as keyof typeof Moves]
}

const getMoveColor = (type?: string, fallback?: string) => {
  if (!type) return fallback ?? '#6d7c86'
  return TYPE_COLORS[type] ?? fallback ?? '#6d7c86'
}

const determineAnimationType = (moveData?: { category?: string; flags?: Record<string, number> }) => {
  if (!moveData) return undefined
  const { category, flags } = moveData
  if (category === 'Status') return 'status'
  if (category === 'Physical' || category === 'Special') {
    return flags?.contact ? 'contact' : 'ranged'
  }
  return undefined
}

export function AttackPanel({ onSwap, teamOptions, activeSelection, onAttack, disabledSlots, hidden }: AttackPanelProps) {
  const [highlighted, setHighlighted] = useState<Record<PokemonSlot, AttackSlotId | null>>({
    p1: null,
    p2: null,
  })

  const resolveAttacks = (slot: PokemonSlot) => {
    const fallbackSelection = teamOptions[slot][0]
    const selection = activeSelection?.[slot] ?? fallbackSelection
    const moves =
      selection && selection.moves && selection.moves.length
        ? selection.moves
        : selection
        ? MOVESET_BY_SPECIES[selection.id] ?? []
        : []
    return POSITION_CONFIG.map((slotConfig, index) => {
      const moveId = moves[index]
      const moveData = resolveMoveData(moveId)
      const label = moveData?.name ?? slotConfig.fallbackLabel
      const color = getMoveColor(moveData?.type, slotConfig.fallbackColor)
      const animationType = determineAnimationType(moveData)
      const IconComponent = TYPE_ICONS[moveData?.type ?? ''] ?? slotConfig.Icon
      return {
        id: slotConfig.id,
        Icon: IconComponent,
        label,
        color,
        animationType,
        target: moveData?.target,
      }
    })
  }

  const handleShuffle = (slot: PokemonSlot) => {
    const options = teamOptions[slot]
    const current = activeSelection?.[slot]
    if (!options.length) return
    const currentIndex = current
      ? options.findIndex((selection) =>
          current.selectionId
            ? selection.selectionId === current.selectionId
            : selection.id === current.id && selection.isRare === current.isRare
        )
      : -1
    const next = options[(currentIndex + 1 + options.length) % options.length]
    if (next) {
      onSwap?.(slot, next)
    }
  }

  const handleAttack = (slot: PokemonSlot, attackId: AttackSlotId, attacksForSlot: ReturnType<typeof resolveAttacks>) => {
    const attack = attacksForSlot.find((attack) => attack.id === attackId)
    if (!attack || !attack.animationType) return
    onAttack?.({
      slot,
      moveName: attack.label,
      animationType: attack.animationType as 'contact' | 'ranged' | 'status',
      moveTarget: attack.target,
    })
  }

  const toggleHighlight = (slot: PokemonSlot, id: AttackSlotId | null) => {
    setHighlighted((current) => ({ ...current, [slot]: id }))
  }

  const isActive = (slot: PokemonSlot, id: AttackSlotId) => highlighted[slot] === id

  const panelClass = hidden ? 'attack-panel attack-panel--hidden' : 'attack-panel attack-panel--visible'

  return (
    <div className={panelClass}>
      {(['p1'] as PokemonSlot[]).map((slot) => {
     /*  {(['p1', 'p2'] as PokemonSlot[]).map((slot) => { */
        const attacks = resolveAttacks(slot)
        return (
            <div className={`attack-panel__section${disabledSlots?.[slot] ? ' is-disabled' : ''}`} key={slot}>
            <span
              className={'attack-panel__label attack-panel__label--left' + (isActive(slot, 'left') ? ' is-active' : '')}
              onMouseEnter={() => toggleHighlight(slot, 'left')}
              onMouseLeave={() => toggleHighlight(slot, null)}
            >
              {attacks[2].label}
            </span>
            <div className="attack-panel__middle-column">
              <button
                type="button"
                className="attack-panel__swap"
                onClick={() => handleShuffle(slot)}
                disabled={disabledSlots?.[slot]}
              >
                <GiSwapBag aria-hidden="true" />
              </button>
              <span
                className={'attack-panel__label attack-panel__label--top' + (isActive(slot, 'top') ? ' is-active' : '')}
                onMouseEnter={() => toggleHighlight(slot, 'top')}
                onMouseLeave={() => toggleHighlight(slot, null)}
              >
                {attacks[0].label}
              </span>

              <div className="attack-panel__diamond">
                <div className="attack-panel__grid">
                  {attacks.map(({ id, Icon, color }) => (
                    <button
                      key={`${slot}-${id}`}
                      type="button"
                      className={
                        'attack-panel__button ' +
                        (isActive(slot, id) ? 'is-active ' : '') +
                        (disabledSlots?.[slot] ? 'is-disabled' : '')
                      }
                      style={{ background: color }}
                      onMouseEnter={() => toggleHighlight(slot, id)}
                      onMouseLeave={() => toggleHighlight(slot, null)}
                      onClick={() => !disabledSlots?.[slot] && handleAttack(slot, id, attacks)}
                    >
                      <Icon className="attack-panel__icon" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <span
                className={
                  'attack-panel__label attack-panel__label--bottom' + (isActive(slot, 'bottom') ? ' is-active' : '')
                }
                onMouseEnter={() => toggleHighlight(slot, 'bottom')}
                onMouseLeave={() => toggleHighlight(slot, null)}
              >
                {attacks[3].label}
              </span>
            </div>
            <span
              className={'attack-panel__label attack-panel__label--right' + (isActive(slot, 'right') ? ' is-active' : '')}
              onMouseEnter={() => toggleHighlight(slot, 'right')}
              onMouseLeave={() => toggleHighlight(slot, null)}
            >
              {attacks[1].label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
