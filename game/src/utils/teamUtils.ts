import type { DexCatalogState, DexSpeciesEntry } from '../hooks/useDexCatalog';
import type {
	SlotSelection,
	StatsTablePayload,
	TripleBattleTeamPayload,
	TripleBattleTeamsPayload,
	TeamSelections,
	PokemonSetPayload,
	DropdownOption,
} from '../types/battle';

export const toOptions = (list: string[]): DropdownOption[] => list.map(value => ({ value, label: value }));

export const DEFAULT_EVS: StatsTablePayload = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
export const DEFAULT_IVS: StatsTablePayload = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
export const DEFAULT_LEVEL = 50;
export const DEFAULT_NATURE = 'Serious';

export const STAT_KEYS: (keyof StatsTablePayload)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS: Record<keyof StatsTablePayload, string> = {
	hp: 'HP',
	atk: 'Atk',
	def: 'Def',
	spa: 'SpA',
	spd: 'SpD',
	spe: 'Spe',
};
export const NATURES = [
	'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy', 'Hasty', 'Impish', 'Jolly',
	'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty', 'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious',
	'Timid',
];
export const NATURE_OPTIONS = toOptions(NATURES);

export const collectBaseMoves = (teams: TripleBattleTeamsPayload) => {
	const pool = new Set<string>();
	for (const side of Object.values(teams)) {
		for (const mon of side.roster) {
			for (const move of mon.moves) pool.add(move);
		}
	}
	return Array.from(pool);
};

export const padMoves = (primary: string[], fallback: string[] = []): string[] => {
	const result: string[] = [];
	for (let i = 0; i < 4; i++) {
		const candidate = primary[i]?.trim();
		result.push(candidate ?? fallback[i] ?? '');
	}
	return result;
};

export const sanitizeMoves = (slotMoves: string[], baseMoves: string[]): string[] => {
	const result: string[] = [];
	for (let i = 0; i < 4; i++) {
		const candidate = slotMoves[i]?.trim();
		result.push(candidate ?? baseMoves[i] ?? '');
	}
	return result;
};

export const cloneStats = (stats: StatsTablePayload): StatsTablePayload => ({
	hp: stats.hp,
	atk: stats.atk,
	def: stats.def,
	spa: stats.spa,
	spd: stats.spd,
	spe: stats.spe,
});

export const statsDiffer = (stats: StatsTablePayload | undefined, baseline: StatsTablePayload) => {
	if (!stats) return false;
	return STAT_KEYS.some(stat => stats[stat] !== baseline[stat]);
};

export const clampNumber = (value: number, min: number, max: number) => {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
};

export const sanitizeStatsTable = (
	input: StatsTablePayload | null | undefined,
	fallback: StatsTablePayload,
	min: number,
	max: number,
): StatsTablePayload => {
	const result = {} as StatsTablePayload;
	for (const key of STAT_KEYS) {
		const val = input?.[key];
		result[key] = clampNumber(typeof val === 'number' ? val : fallback[key], min, max);
	}
	return result;
};

export const createSlotFromSet = (set: PokemonSetPayload): SlotSelection => ({
	species: set.species,
	item: set.item,
	ability: set.ability,
	moves: padMoves(set.moves),
	nature: set.nature || DEFAULT_NATURE,
	gender: (set.gender as SlotSelection['gender']) || 'N',
	level: set.level || DEFAULT_LEVEL,
	evs: cloneStats(set.evs || DEFAULT_EVS),
	ivs: cloneStats(set.ivs || DEFAULT_IVS),
});

export const createInitialSelections = (teams: TripleBattleTeamsPayload): TeamSelections => ({
	p1: teams.p1.roster.map(createSlotFromSet),
	p2: teams.p2.roster.map(createSlotFromSet),
});

export const getSpeciesEntry = (speciesName: string, catalog: DexCatalogState | null): DexSpeciesEntry | null => {
	if (!catalog || !speciesName) return null;
	return catalog.speciesMap[speciesName.toLowerCase()] ?? null;
};

export const getAvailableGenders = (speciesName: string, catalog: DexCatalogState | null): Array<'M' | 'F' | 'N'> => {
	const entry = getSpeciesEntry(speciesName, catalog);
	if (entry?.availableGenders?.length) return entry.availableGenders;
	return ['M', 'F', 'N'];
};

export const getAbilityOptions = (speciesName: string, catalog: DexCatalogState | null): DropdownOption[] => {
	const entry = getSpeciesEntry(speciesName, catalog);
	if (entry?.abilities?.length) return toOptions(entry.abilities);
	if (catalog?.abilities?.length) return toOptions(catalog.abilities);
	return [];
};

export const getMoveOptions = (
	speciesName: string,
	catalog: DexCatalogState | null,
	global: DropdownOption[],
): DropdownOption[] => {
	const entry = getSpeciesEntry(speciesName, catalog);
	if (!entry) return global;
	return entry.moves.length ? toOptions(entry.moves) : global;
};

export const applySpeciesDefaults = (slot: SlotSelection, catalog: DexCatalogState | null): SlotSelection => {
	const entry = getSpeciesEntry(slot.species, catalog);
	if (!entry) return slot;
	const next = { ...slot };
	if (entry.defaultAbility) next.ability = entry.defaultAbility;
	if (entry.defaultItem) next.item = entry.defaultItem;
	if (entry.defaultMoves?.length) next.moves = padMoves(entry.defaultMoves, slot.moves);
	else if (entry.moves?.length) next.moves = padMoves(entry.moves, slot.moves);
	if (entry.defaultNature) next.nature = entry.defaultNature;
	if (entry.defaultLevel) next.level = entry.defaultLevel;
	if (entry.availableGenders?.length) {
		next.gender = entry.availableGenders[0];
	} else if (entry.defaultGender) {
		next.gender = entry.defaultGender;
	}
	if (statsDiffer(entry.defaultEvs, DEFAULT_EVS)) next.evs = cloneStats(entry.defaultEvs);
	if (statsDiffer(entry.defaultIvs, DEFAULT_IVS)) next.ivs = cloneStats(entry.defaultIvs);
	return next;
};

export const buildTeamsPayload = (teams: TeamSelections, baseTeams: TripleBattleTeamsPayload): TripleBattleTeamsPayload => {
	const cloneTeam = (side: 'p1' | 'p2'): TripleBattleTeamPayload => {
		const baseTeam = baseTeams[side];
		return {
			name: baseTeam.name,
			roster: baseTeam.roster.map((set, idx) => {
				const slot = teams[side][idx];
				const speciesCandidate = slot?.species?.trim();
				const itemCandidate = slot?.item?.trim();
				const abilityCandidate = slot?.ability?.trim();
				const species = speciesCandidate?.length ? speciesCandidate : set.species;
				const item = itemCandidate?.length ? itemCandidate : set.item;
				const ability = abilityCandidate?.length ? abilityCandidate : set.ability;
				const moves = sanitizeMoves(slot?.moves || [], set.moves);
				const nature = slot?.nature?.trim() || set.nature || DEFAULT_NATURE;
				const gender = slot?.gender || (set.gender as SlotSelection['gender']) || 'N';
				const level = clampNumber(slot?.level ?? set.level ?? DEFAULT_LEVEL, 1, 100);
				const evs = sanitizeStatsTable(slot?.evs, set.evs || DEFAULT_EVS, 0, 252);
				const ivs = sanitizeStatsTable(slot?.ivs, set.ivs || DEFAULT_IVS, 0, 31);
				return {
					...set,
					name: species,
					species,
					item,
					ability,
					moves,
					nature,
					gender,
					level,
					evs,
					ivs,
				};
			}),
		};
	};
	return {
		p1: cloneTeam('p1'),
		p2: cloneTeam('p2'),
	};
};
