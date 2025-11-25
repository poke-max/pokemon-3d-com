export type StatsTablePayload = {
	hp: number;
	atk: number;
	def: number;
	spa: number;
	spd: number;
	spe: number;
};

export interface PokemonSetPayload {
	name: string;
	species: string;
	item: string;
	ability: string;
	moves: string[];
	nature: string;
	gender: string;
	evs: StatsTablePayload;
	ivs: StatsTablePayload;
	level: number;
	shiny?: boolean;
	happiness?: number;
	pokeball?: string;
	hpType?: string;
	dynamaxLevel?: number;
	gigantamax?: boolean;
	teraType?: string;
}

export interface TripleBattleTeamPayload {
	name: string;
	roster: PokemonSetPayload[];
}

export type TripleBattleTeamsPayload = Record<'p1' | 'p2', TripleBattleTeamPayload>;

export type SlotSelection = {
	species: string;
	item: string;
	ability: string;
	moves: string[];
	nature: string;
	gender: 'M' | 'F' | 'N';
	level: number;
	evs: StatsTablePayload;
	ivs: StatsTablePayload;
};

export type TeamSelections = Record<'p1' | 'p2', SlotSelection[]>;

export interface TripleBattleResult {
	view: TripleBattleSnapshot;
	log: string[];
}

export interface PokemonSummary {
	slot: number;
	nickname: string;
	species: string;
	types: string[];
	item: string | null;
	ability: string;
	moves: string[];
}

export interface TeamSummary {
	name: string;
	pokemon: PokemonSummary[];
}

export interface TripleBattleSnapshot {
	format: string;
	sides: Record<'p1' | 'p2', TeamSummary>;
}

export interface ManualBattleState {
	id: string;
	log: string[];
	request: any | null;
	ended: boolean;
	winner?: string;
	player?: {
		ident: string;
		condition: string;
	};
	foe?: {
		ident: string;
		condition: string;
	};
}

export interface DropdownOption {
	value: string;
	label: string;
}
