import { BattleStream, Dex, getPlayerStreams, Teams } from '../../sim';
import type { ModdedDex } from '../../sim/dex';
import type { PRNGSeed } from '../../sim/prng';
import type { PokemonSet } from '../../sim/teams';
import { RandomPlayerAI } from '../../sim/tools/random-player-ai';

type StatsTable = Dex.StatsTable;
type SparseStatsTable = Dex.SparseStatsTable;

type PlayerSlot = 'p1' | 'p2';

export interface TripleBattleSpec {
	formatid: string;
	seed?: PRNGSeed;
	rated?: boolean | string;
	debug?: boolean;
	strictChoices?: boolean;
}

export interface TripleBattleTeam {
	name: string;
	roster: PokemonSet[];
}

export type TripleBattleTeams = Record<PlayerSlot, TripleBattleTeam>;

export interface PokemonSummary {
	slot: number;
	nickname: string;
	species: string;
	types: string[];
	level: number;
	item: string | null;
	ability: string;
	moves: string[];
	teraType: string;
	baseStats: StatsTable;
}

export interface TeamSummary {
	name: string;
	pokemon: PokemonSummary[];
}

export interface TripleBattleSnapshot {
	format: string;
	sides: Record<PlayerSlot, TeamSummary>;
}

export interface TripleBattleResult {
	view: TripleBattleSnapshot;
	log: string[];
}

const ZERO_EVS: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const MAX_IVS: StatsTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const DEFAULT_SPEC: TripleBattleSpec = {
	formatid: 'gen9customgame',
};

export class TripleBattleComponent {
	private readonly dex: ModdedDex;

	constructor(private readonly spec: TripleBattleSpec = DEFAULT_SPEC) {
		this.dex = Dex.forFormat(spec.formatid);
	}

	summarize(teams: TripleBattleTeams = DEFAULT_TEAMS): TripleBattleSnapshot {
		return {
			format: this.spec.formatid,
			sides: {
				p1: this.summarizeTeam('p1', teams.p1),
				p2: this.summarizeTeam('p2', teams.p2),
			},
		};
	}

	async simulate(teams: TripleBattleTeams = DEFAULT_TEAMS): Promise<TripleBattleResult> {
		const snapshot = this.summarize(teams);
		const streams = getPlayerStreams(new BattleStream());
		const log: string[] = [];

		const logTask = (async () => {
			for await (const chunk of streams.omniscient) {
				log.push(chunk);
			}
		})();

		const p1AI = new RandomPlayerAI(streams.p1);
		const p2AI = new RandomPlayerAI(streams.p2);
		void p1AI.start();
		void p2AI.start();

		const bootScript = [
			`>start ${JSON.stringify(this.spec)}`,
			`>player p1 ${JSON.stringify({ name: teams.p1.name, team: Teams.pack(teams.p1.roster) })}`,
			`>player p2 ${JSON.stringify({ name: teams.p2.name, team: Teams.pack(teams.p2.roster) })}`,
		].join('\n');

		await streams.omniscient.write(bootScript);
		await logTask;

		return { view: snapshot, log };
	}

	private summarizeTeam(slot: PlayerSlot, team: TripleBattleTeam): TeamSummary {
		return {
			name: `${team.name} (${slot.toUpperCase()})`,
			pokemon: team.roster.slice(0, 3).map((set, idx) => this.describePokemon(idx, set)),
		};
	}

	private describePokemon(index: number, set: PokemonSet): PokemonSummary {
		const species = this.resolveSpecies(set);
		const ability = this.dex.abilities.get(set.ability || species.abilities['0']);
		const abilityName = ability?.exists ? ability.name : 'Unknown Ability';
		const moves = (set.moves || []).map((moveName: string) => {
			const move = this.dex.moves.get(moveName);
			return move?.exists ? move.name : moveName;
		});

		return {
			slot: index + 1,
			nickname: set.name || species.name,
			species: species.name,
			types: species.types,
			level: set.level || 50,
			item: set.item || null,
			ability: abilityName,
			moves,
			teraType: set.teraType || species.types[0] || 'Normal',
			baseStats: species.baseStats,
		};
	}

	private resolveSpecies(set: PokemonSet) {
		const species = this.dex.species.get(set.species || set.name || '');
		if (species?.exists) return species;
		return this.dex.species.get('Bulbasaur');
	}
}

type PokemonSetConfig = Omit<Partial<PokemonSet>, 'evs' | 'ivs'> & {
	species: string;
	moves: string[];
	evs?: SparseStatsTable;
	ivs?: SparseStatsTable;
};

function spread(base: StatsTable, overrides?: Partial<StatsTable>): StatsTable {
	return { ...base, ...(overrides || {}) };
}

function buildSet(config: PokemonSetConfig): PokemonSet {
	return {
		name: config.name ?? config.species,
		species: config.species,
		item: config.item ?? 'Leftovers',
		ability: config.ability ?? 'No Ability',
		moves: config.moves,
		nature: config.nature ?? 'Serious',
		gender: config.gender ?? '',
		evs: spread(ZERO_EVS, config.evs ?? undefined),
		ivs: spread(MAX_IVS, config.ivs ?? undefined),
		level: config.level ?? 50,
		shiny: config.shiny,
		happiness: config.happiness,
		pokeball: config.pokeball,
		hpType: config.hpType,
		dynamaxLevel: config.dynamaxLevel ?? 10,
		gigantamax: config.gigantamax,
		teraType: config.teraType,
	};
}

export const DEFAULT_TEAMS: TripleBattleTeams = {
	p1: {
		name: 'Equipo Azul',
		roster: [
			buildSet({
				name: 'Sparky',
				species: 'Pikachu',
				item: 'Light Ball',
				ability: 'Lightning Rod',
				moves: ['Thunderbolt', 'Volt Tackle', 'Grass Knot', 'Protect'],
				nature: 'Timid',
				gender: 'M',
				evs: { hp: 4, spa: 252, spe: 252 },
				ivs: MAX_IVS,
				teraType: 'Electric',
			}),
			buildSet({
				species: 'Charizard',
				item: 'Life Orb',
				ability: 'Solar Power',
				moves: ['Flamethrower', 'Air Slash', 'Dragon Pulse', 'Roost'],
				nature: 'Modest',
				gender: 'M',
				evs: { hp: 4, spa: 252, spe: 252 },
				teraType: 'Fire',
			}),
			buildSet({
				species: 'Greninja',
				item: 'Focus Sash',
				ability: 'Protean',
				moves: ['Hydro Pump', 'Ice Beam', 'Dark Pulse', 'U-turn'],
				nature: 'Timid',
				gender: 'M',
				evs: { atk: 4, spa: 252, spe: 252 },
				teraType: 'Water',
			}),
		],
	},
	p2: {
		name: 'Equipo Carmesí',
		roster: [
			buildSet({
				species: 'Garchomp',
				item: 'Yache Berry',
				ability: 'Rough Skin',
				moves: ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
				nature: 'Jolly',
				gender: 'M',
				evs: { hp: 4, atk: 252, spe: 252 },
				teraType: 'Ground',
			}),
			buildSet({
				species: 'Corviknight',
				item: 'Leftovers',
				ability: 'Mirror Armor',
				moves: ['Brave Bird', 'Body Press', 'Roost', 'Tailwind'],
				nature: 'Impish',
				gender: 'M',
				evs: { hp: 252, def: 252, spd: 4 },
				teraType: 'Flying',
			}),
			buildSet({
				species: 'Iron Valiant',
				item: 'Booster Energy',
				ability: 'Quark Drive',
				moves: ['Moonblast', 'Close Combat', 'Knock Off', 'Psyshock'],
				nature: 'Naive',
				gender: 'N',
				evs: { atk: 4, spa: 252, spe: 252 },
				teraType: 'Fairy',
			}),
		],
	},
};
