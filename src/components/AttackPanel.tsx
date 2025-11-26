import { useState } from 'react'
import { GiCrossedSwords, GiFireBreath, GiRapidshareArrow, GiHealing, GiSwapBag } from 'react-icons/gi'
import type { IconType } from 'react-icons'
import type { PokemonSlot, PokemonSelection } from '../phaser/PlaygroundScene'
import './AttackPanel.css'

type AttackPanelProps = {
  onSwap?: (slot: PokemonSlot, selection: PokemonSelection) => void
  teamOptions: Record<PokemonSlot, PokemonSelection[]>
  activeSelection?: Record<PokemonSlot, PokemonSelection | null>
  moveMeta?: Record<PokemonSlot, Array<{ name: string; target?: string }>>
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

const POSITION_CONFIG = [
  { id: 'top' as const, Icon: GiCrossedSwords, fallbackLabel: 'Attack 1', fallbackColor: '#6986e7' },
  { id: 'right' as const, Icon: GiHealing, fallbackLabel: 'Attack 2', fallbackColor: '#6d7c86' },
  { id: 'left' as const, Icon: GiRapidshareArrow, fallbackLabel: 'Attack 3', fallbackColor: '#4c64d6' },
  { id: 'bottom' as const, Icon: GiFireBreath, fallbackLabel: 'Attack 4', fallbackColor: '#d4752f' },
]

export function AttackPanel({
  onSwap,
  teamOptions,
  activeSelection,
  moveMeta,
  onAttack,
  disabledSlots,
  hidden,
}: AttackPanelProps) {
  const [highlighted, setHighlighted] = useState<Record<PokemonSlot, AttackSlotId | null>>({
    p1: null,
    p2: null,
  })

  const resolveAttacks = (slot: PokemonSlot) => {
    const options = teamOptions[slot] ?? []
    const fallbackSelection = options[0]
    const selection = activeSelection?.[slot] ?? fallbackSelection
    if (!selection) return [] as Array<any>
    const meta = moveMeta?.[slot] ?? []
    const moves = selection?.moves ?? []
    return POSITION_CONFIG.map((slotConfig, index) => {
      const moveName = moves[index] ?? meta[index]?.name
      if (!moveName) return null
      const moveTarget = meta[index]?.target
      const animationType =
        moveTarget?.includes('self') || moveTarget?.includes('ally')
          ? 'status'
          : 'ranged'
      const color = '#6d7c86'
      const IconComponent = slotConfig.Icon
      return {
        id: slotConfig.id,
        Icon: IconComponent,
        label: moveName,
        color,
        animationType,
        target: moveTarget,
      }
    }).filter(Boolean) as Array<{
      id: AttackSlotId
      Icon: IconType
      label: string
      color: string
      animationType: 'contact' | 'ranged' | 'status' | undefined
      target?: string
    }>
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
        if (!attacks.length) return null
        const attackById = (id: AttackSlotId) => attacks.find((attack) => attack.id === id)
        const attackLeft = attackById('left')
        const attackTop = attackById('top')
        const attackRight = attackById('right')
        const attackBottom = attackById('bottom')
        if (!attackLeft && !attackTop && !attackRight && !attackBottom) return null
        return (
            <div className={`attack-panel__section${disabledSlots?.[slot] ? ' is-disabled' : ''}`} key={slot}>
            <span
              className={'attack-panel__label attack-panel__label--left' + (isActive(slot, 'left') ? ' is-active' : '')}
              onMouseEnter={() => toggleHighlight(slot, 'left')}
              onMouseLeave={() => toggleHighlight(slot, null)}
            >
              {attackLeft?.label ?? ''}
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
                {attackTop?.label ?? ''}
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
                {attackBottom?.label ?? ''}
              </span>
            </div>
            <span
              className={'attack-panel__label attack-panel__label--right' + (isActive(slot, 'right') ? ' is-active' : '')}
              onMouseEnter={() => toggleHighlight(slot, 'right')}
              onMouseLeave={() => toggleHighlight(slot, null)}
            >
              {attackRight?.label ?? ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
