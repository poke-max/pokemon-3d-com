import type { PokemonSpecies } from '../phaser/PlaygroundScene'

export const STATUS_LABELS = {
  brn: 'burned',
  par: 'paralyzed',
  slp: 'asleep',
  frz: 'frozen',
  psn: 'poisoned',
  tox: 'badly poisoned',
} as const

export const STAT_LABELS = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
} as const

export type StatId = keyof typeof STAT_LABELS

export type PokemonSpeciesMeta = {
  name: string
  nickname: string
  level: number
  hp: { current: number; max: number }
  status?: keyof typeof STATUS_LABELS
  stages?: Partial<Record<StatId, number>>
}

export const SPECIES_META: Record<PokemonSpecies, PokemonSpeciesMeta> = {
  '1012': {
    name: 'Meowscarada',
    nickname: 'Meowscarada',
    level: 72,
    hp: { current: 120, max: 140 },
    status: 'brn',
    stages: { atk: 2, spe: 1 },
  },
  '1013': {
    name: 'Fuecoco',
    nickname: 'Fuecoco',
    level: 40,
    hp: { current: 90, max: 120 },
    status: 'par',
    stages: { def: -1, spa: 1 },
  },
  '0978': {
    name: 'Dragapult',
    nickname: 'Dragapult',
    level: 65,
    hp: { current: 110, max: 150 },
    status: 'slp',
    stages: { spe: -2 },
  },
  '0282': {
    name: 'Gardevoir',
    nickname: 'Gardevoir',
    level: 58,
    hp: { current: 95, max: 130 },
    status: 'slp',
    stages: { spa: 1 },
  },
  '0004': {
    name: 'Charmander',
    nickname: 'Charmander',
    level: 20,
    hp: { current: 50, max: 80 },
  },

}
