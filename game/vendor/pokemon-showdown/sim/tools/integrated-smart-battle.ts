/**
 * Integrated Smart Battle helpers.
 *
 * Provides a way to run SmartPlayer-like logic within the simulator itself
 * by cloning the current battle state and asking the real damage calculator
 * how much each move would deal before committing a choice.
 */

import { Battle, type RequestState } from '../battle';
import { Dex } from '../dex';
import { State } from '../state';
import type { Pokemon } from '../pokemon';
import type {
	ChoiceRequest,
	MoveRequest,
	PokemonMoveRequestData,
	Side,
	SideID,
	SwitchRequest,
	TeamPreviewRequest,
} from '../side';

interface IntegratedSmartOptions {
	logger?: (message: string) => void;
}

type MoveEvaluation = {
	index: number;
	moveId: string;
	name: string;
	damage: number;
	type: string;
	category: string;
	status: string | null;
	effects: string[];
	accuracy: number;
	score: number;
	statusInfo?: StatusImpact[];
	supportTags?: string[];
};

type StatusImpact = {
	status: string;
	chance: number;
	applies: boolean;
};

type TeamSnapshotEntry = {
	ident: string;
	details: string;
	level: number;
	stats: Pokemon['baseStoredStats'] | null;
	condition: string;
	currentHp: number | null;
	maxHp: number | null;
	moves: string[];
};

/**
 * Wraps a running Battle instance and lets you register SmartAI controllers
 * that run directly on the simulator instead of on the stream output.
 */
export class IntegratedBattleManager {
	private readonly controllers = new Map<SideID, IntegratedSmartController>();
	private patched = false;
	private originalMakeRequest: Battle['makeRequest'] | null = null;

	constructor(private readonly battle: Battle) {
		this.patchMakeRequest();
	}

	register(sideId: SideID, options: IntegratedSmartOptions = {}) {
		if (this.controllers.has(sideId)) return;
		const controller = new IntegratedSmartController(this.battle, sideId, options);
		this.controllers.set(sideId, controller);
		controller.handlePendingRequest();
	}

	private patchMakeRequest() {
		if (this.patched) return;
		this.patched = true;
		this.originalMakeRequest = this.battle.makeRequest;
		const manager = this;
		this.battle.makeRequest = function patchedMakeRequest(this: Battle, type?: RequestState) {
			const result = manager.originalMakeRequest!.call(this, type);
			manager.dispatchRequests();
			return result;
		} as Battle['makeRequest'];
	}

	private dispatchRequests() {
		for (const controller of this.controllers.values()) {
			controller.handlePendingRequest();
		}
	}
}

class IntegratedSmartController {
	constructor(
		private readonly battle: Battle,
		private readonly sideId: SideID,
		private readonly options: IntegratedSmartOptions,
	) {}

	handlePendingRequest() {
		const side = this.battle.getSide(this.sideId);
		const request = side.activeRequest;
		if (!request) return;
		if (isTeamPreviewRequest(request)) {
			this.handleTeamPreviewRequest(request);
			return;
		}
		if (isSwitchRequest(request)) {
			this.handleSwitchRequest(request);
			return;
		}
		if (isMoveRequest(request)) {
			this.handleMoveRequest(request);
		}
	}

	private handleTeamPreviewRequest(request: TeamPreviewRequest) {
		const order = request.side?.pokemon?.map((_, idx) => idx + 1).join('') ?? '';
		const command = order ? `team ${order}` : 'team';
		this.battle.choose(this.sideId, command);
		if (this.options.logger) {
			this.options.logger(`[IntegratedSmartAI] Confirmo el orden inicial (${order || 'default'})`);
		}
	}

	private handleSwitchRequest(request: SwitchRequest) {
		const side = this.battle.getSide(this.sideId);
		this.logTeamSnapshots(side);
		const battleState = State.serializeBattle(this.battle);
		const reserved = new Set<Pokemon>();
		const choices = request.forceSwitch.map((mustSwitch, index) => {
			if (!mustSwitch) return 'pass';
			const current = side.active[index];
			if (!current) return 'pass';
			const foeTarget = this.pickTarget(current) ?? this.pickAnyOpponent(side);
			let selection: {command: string; pokemon: Pokemon} | null = null;
			if (foeTarget) {
				selection = this.chooseBestSwitch(side, current, foeTarget, battleState, reserved);
			}
			if (!selection) {
				selection = this.chooseFallbackSwitch(side, reserved);
			}
			if (!selection) return 'pass';
			reserved.add(selection.pokemon);
			if (foeTarget) {
				this.logSwitchChoice(current, selection.pokemon, foeTarget, 'cumplir con un cambio forzoso');
			}
			return selection.command;
		});
		if (choices.length) {
			this.battle.choose(this.sideId, choices.join(', '));
		}
	}

	private handleMoveRequest(request: MoveRequest) {
		const side = this.battle.getSide(this.sideId);
		this.logTeamSnapshots(side);
		const choices: string[] = [];
		request.active.forEach((slot, index) => {
			const pokemon = side.active[index];
			if (!pokemon || pokemon.fainted) {
				choices.push('pass');
				return;
			}
			const target = this.pickTarget(pokemon);
			if (!target) {
				choices.push('pass');
				return;
			}
			const battleState = State.serializeBattle(this.battle);
			const evaluation = this.evaluateMoves(pokemon, slot, target, battleState);
			if (!evaluation.length) {
				choices.push('pass');
				return;
			}
			const switchReason = this.shouldSwitchOut(pokemon, slot, target, evaluation, battleState);
			if (switchReason) {
				const switchChoice = this.chooseBestSwitch(side, pokemon, target, battleState);
				if (switchChoice) {
					this.logSwitchChoice(pokemon, switchChoice.pokemon, target, switchReason);
					choices.push(switchChoice.command);
					return;
				}
			}
			this.logEvaluation(pokemon, target, evaluation);
			const targetHp = Math.max(1, target.hp);
			const halfHpCandidates = evaluation.filter(entry => entry.damage >= targetHp / 2);
			const pool = halfHpCandidates.length ? halfHpCandidates : evaluation;
			const best = pool.reduce((bestMove, current) => {
				if (current.score === bestMove.score) {
					return current.damage > bestMove.damage ? current : bestMove;
				}
				return current.score > bestMove.score ? current : bestMove;
			});
			this.logChosenMove(pokemon, target, best);
			choices.push(`move ${best.index + 1}`);
		});
		if (choices.length) {
			this.battle.choose(this.sideId, choices.join(', '));
		}
	}

	private evaluateMoves(
		attacker: Pokemon,
		moveSlot: PokemonMoveRequestData,
		target: Pokemon,
		battleState?: string,
	): MoveEvaluation[] {
		const available = moveSlot.moves
			.map((entry, index) => ({ entry, index }))
			.filter(info => !info.entry.disabled);
		const serialized = battleState ?? State.serializeBattle(this.battle);
		const evaluations: MoveEvaluation[] = [];
		for (const { entry, index } of available) {
			const moveId = entry.id || entry.move;
			const resolvedMove = this.battle.dex.moves.get(moveId);
			const damage = this.simulateDamage(attacker, target, moveId, serialized);
			const extra = this.describeMoveEffects(resolvedMove);
			const accuracy = typeof resolvedMove.accuracy === 'number' ? resolvedMove.accuracy : 100;
			const statusInfo = this.evaluateStatusImpacts(attacker, target, resolvedMove, moveId, serialized);
			const supportTags = this.collectSupportTags(resolvedMove);
			const score = this.scoreMove(attacker, target, resolvedMove, damage, accuracy, statusInfo, supportTags);
			evaluations.push({
				index,
				moveId,
				name: entry.move,
				damage,
				type: resolvedMove.type || '???',
				category: resolvedMove.category || 'Status',
				status: extra.status,
				effects: extra.effects,
				accuracy,
				score,
				statusInfo,
				supportTags,
			});
		}
		return evaluations;
	}

	private simulateDamage(attacker: Pokemon, target: Pokemon, moveId: string, serializedState?: string): number {
		const snapshot = serializedState ?? State.serializeBattle(this.battle);
		const clone = State.deserializeBattle(snapshot);
		const clonedAttacker = clone.getPokemon(attacker.fullname);
		const clonedTarget = clone.getPokemon(target.fullname);
		if (!clonedAttacker || !clonedTarget) return 0;
		const move = clone.dex.getActiveMove(moveId);
		const result = clone.actions.getDamage(clonedAttacker, clonedTarget, move, true);
		return typeof result === 'number' ? Math.max(0, result) : 0;
	}

	private pickTarget(pokemon: Pokemon): Pokemon | null {
		const foeSide = pokemon.side.foe;
		for (const foe of foeSide.active) {
			if (foe && !foe.fainted) return foe;
		}
		return null;
	}

	private pickAnyOpponent(side: Side): Pokemon | null {
		for (const foe of side.foe.active) {
			if (foe && !foe.fainted) return foe;
		}
		return null;
	}

	private scoreMove(
		attacker: Pokemon,
		target: Pokemon,
		move: AnyObject,
		damage: number,
		accuracy: number,
		statusInfo: StatusImpact[],
		supportTags: string[] = [],
	) {
		const accuracyFactor = Math.max(0, Math.min(accuracy, 100)) / 100;
		let score = damage * (accuracyFactor || 1);
		score += this.evaluateBoostScore(move, attacker);
		score += this.evaluateStatusScore(statusInfo, attacker, target, accuracyFactor || 1);
		score += this.evaluatePriorityBonus(move, attacker, target, damage);
		score += this.evaluateSupportBonus(supportTags, target);
		return score;
	}

	private evaluateBoostScore(move: AnyObject, attacker?: Pokemon): number {
		const boosts = this.collectSelfBoosts(move);
		if (!boosts) return 0;
		const weights: Record<string, number> = {
			atk: 45,
			def: 35,
			spa: 45,
			spd: 35,
			spe: 40,
			accuracy: 15,
			evasion: 15,
		};
		let total = 0;
		const attackerStats = attacker?.baseStoredStats;
		for (const stat in boosts) {
			let amount = boosts[stat];
			if (!amount) continue;
			let weight = weights[stat] ?? 0;
			if (attackerStats && stat in attackerStats && typeof attackerStats[stat as keyof typeof attackerStats] === 'number') {
				const statValue = attackerStats[stat as keyof typeof attackerStats] as number;
				weight += Math.floor(statValue / 20);
			}
			const currentBoost = attacker?.boosts?.[stat as keyof typeof attacker.boosts] ?? 0;
			if (amount > 0) {
				const remaining = 6 - currentBoost;
				if (remaining <= 0) continue;
				amount = Math.min(amount, remaining);
			} else if (amount < 0) {
				const remaining = -6 - currentBoost;
				if (remaining >= 0) continue;
				amount = Math.max(amount, remaining);
			}
			total += amount * weight;
		}
		return total;
	}

	private collectSelfBoosts(move: AnyObject): AnyObject | null {
		const accumulator: AnyObject = {};
		let found = false;
		const mergeBoosts = (source?: AnyObject | null) => {
			if (!source) return;
			for (const stat in source) {
				const amount = source[stat];
				if (!amount) continue;
				accumulator[stat] = (accumulator[stat] ?? 0) + amount;
				found = true;
			}
		};
		if (move.target === 'self') mergeBoosts(move.boosts);
		if (move.self?.boosts) mergeBoosts(move.self.boosts);
		return found ? accumulator : null;
	}

	private evaluateStatusImpacts(
		attacker: Pokemon,
		target: Pokemon,
		move: AnyObject,
		moveId: string,
		serializedState: string,
	): StatusImpact[] {
		const entries = this.collectStatusChances(move);
		if (!entries.length) return [];
		const impacts: StatusImpact[] = [];
		for (const entry of entries) {
			const statusId = entry.status;
			if (!statusId) continue;
			const applies = this.statusAppliesFromState(
				serializedState,
				attacker,
				target,
				moveId,
				statusId,
			);
			impacts.push({
				status: statusId,
				chance: entry.chance ?? 100,
				applies,
			});
		}
		return impacts;
	}

	private evaluateStatusScore(
		statusInfo: StatusImpact[],
		attacker: Pokemon,
		target: Pokemon,
		accuracyFactor: number,
	): number {
		if (!statusInfo.length) return 0;
		const baseWeights: Record<string, number> = {
			slp: 95,
			frz: 90,
			par: 70,
			brn: 65,
			tox: 70,
			psn: 55,
		};
		const attackerStats = attacker.baseStoredStats ?? attacker.storedStats;
		const targetStats = target.baseStoredStats ?? target.storedStats;
		const targetMaxHp = target.maxhp || target.baseMaxhp || 1;
		let total = 0;
		for (const entry of statusInfo) {
			if (!entry.applies) continue;
			const statusId = Dex.toID(entry.status);
			const weight = baseWeights[statusId];
			if (!weight) continue;
			let adjusted = weight;
			if (statusId === 'par' && attackerStats && targetStats) {
				const attackerSpe = attackerStats.spe ?? 0;
				const targetSpe = targetStats.spe ?? 0;
				if (targetSpe > attackerSpe) {
					const ratio = Math.min(2, targetSpe / Math.max(1, attackerSpe));
					adjusted *= 1 + (ratio - 1) * 0.5;
				}
			} else if (statusId === 'brn' && targetStats) {
				const targetAtk = targetStats.atk ?? 0;
				const targetSpa = targetStats.spa ?? 0;
				if (targetAtk >= targetSpa) adjusted *= 1.2;
			} else if ((statusId === 'psn' || statusId === 'tox') && target.hp > targetMaxHp / 2) {
				adjusted *= 1.15;
			}
			const chanceFactor = entry.chance / 100;
			total += adjusted * chanceFactor * accuracyFactor;
		}
		return total;
	}

	private collectStatusChances(move: AnyObject): Array<{status: string; chance?: number}> {
		const entries: Array<{status: string; chance?: number}> = [];
		if (move.status) {
			entries.push({ status: move.status, chance: typeof move.statusChance === 'number' ? move.statusChance : 100 });
		}
		const handleSecondary = (sec: AnyObject | null | undefined) => {
			if (!sec || !sec.status) return;
			entries.push({ status: sec.status, chance: sec.chance });
		};
		if (Array.isArray(move.secondaries)) {
			for (const secondary of move.secondaries) handleSecondary(secondary);
		} else {
			handleSecondary(move.secondary);
		}
		return entries;
	}

	private statusAppliesFromState(
		serializedState: string,
		attacker: Pokemon,
		target: Pokemon,
		moveId: string,
		statusId: string,
	): boolean {
		if (!target || !statusId) return false;
		const clone = State.deserializeBattle(serializedState);
		const clonedAttacker = clone.getPokemon(attacker.fullname);
		const clonedTarget = clone.getPokemon(target.fullname);
		if (!clonedAttacker || !clonedTarget) return false;
		if (clonedTarget.status) return false;
		const simulatedMove = clone.dex.getActiveMove(moveId);
		if (!simulatedMove) return false;
		this.prepareSimulatedMove(simulatedMove, clonedAttacker);
		if (!this.passesImmunityChecks(clone, simulatedMove, clonedAttacker, clonedTarget)) return false;
		const normalizedStatus = Dex.toID(statusId);
		if (!normalizedStatus) return false;
		if (simulatedMove.status && Dex.toID(simulatedMove.status) !== normalizedStatus) {
			simulatedMove.status = normalizedStatus;
		}
		const applied = clonedTarget.trySetStatus(normalizedStatus, clonedAttacker, simulatedMove);
		if (applied) return true;
		if (normalizedStatus === 'tox') {
			return !!clonedTarget.trySetStatus('psn', clonedAttacker, simulatedMove);
		}
		return false;
	}

	private prepareSimulatedMove(move: AnyObject, attacker: Pokemon) {
		if (move.ignoreImmunity === undefined) {
			move.ignoreImmunity = (move.category === 'Status');
		}
		if (
			move.category === 'Status' &&
			move.target !== 'self' &&
			attacker.hasAbility('prankster')
		) {
			move.pranksterBoosted = true;
		}
	}

	private passesImmunityChecks(
		clone: Battle,
		move: AnyObject,
		attacker: Pokemon,
		target: Pokemon,
	): boolean {
		if (!target.runImmunity(move)) return false;
		if (
			clone.gen >= 6 &&
			move.flags?.powder &&
			target !== attacker &&
			!clone.dex.getImmunity('powder', target)
		) {
			return false;
		}
		if (!clone.singleEvent('TryImmunity', move, {}, target, attacker, move)) {
			return false;
		}
		if (
			clone.gen >= 7 &&
			move.pranksterBoosted &&
			!target.isAlly(attacker) &&
			!clone.dex.getImmunity('prankster', target)
		) {
			return false;
		}
		return true;
	}

	private evaluatePriorityBonus(move: AnyObject, attacker: Pokemon, target: Pokemon, damage: number): number {
		if (!move || !move.priority || move.priority <= 0) return 0;
		let bonus = 0;
		const targetHp = Math.max(1, target.hp);
		if (damage >= targetHp) bonus += 35;
		const attackerStats = attacker.baseStoredStats ?? attacker.storedStats;
		const targetStats = target.baseStoredStats ?? target.storedStats;
		if (attackerStats && targetStats) {
			const attackerSpe = (attackerStats.spe ?? 0) + attacker.boosts.spe * 10;
			const targetSpe = (targetStats.spe ?? 0) + target.boosts.spe * 10;
			if (targetSpe >= attackerSpe) bonus += 15;
		}
		return bonus;
	}

	private evaluateSupportBonus(tags: string[], target: Pokemon): number {
		if (!tags.length) return 0;
		const weights: Record<string, number> = {
			stealthrock: 55,
			spikes: 45,
			toxicspikes: 50,
			stickyweb: 55,
			gmaxsteelsurge: 60,
		};
		let total = 0;
		const foeSide = target.side;
		for (const tag of tags) {
			const weight = weights[tag];
			if (!weight) continue;
			const alreadyPresent = tag in foeSide.sideConditions;
			const bonus = alreadyPresent ? weight * 0.25 : weight;
			total += bonus;
		}
		return total;
	}

	private collectSupportTags(move: AnyObject): string[] {
		if (!move) return [];
		const tags: string[] = [];
		if (typeof move.sideCondition === 'string') tags.push(move.sideCondition);
		if (move.self?.sideCondition) tags.push(move.self.sideCondition);
		return tags;
	}

	private shouldSwitchOut(
		attacker: Pokemon,
		slot: PokemonMoveRequestData,
		target: Pokemon,
		evaluations: MoveEvaluation[],
		battleState: string,
	): string | null {
		if (!evaluations.length) return null;
		if (slot.trapped || slot.maybeTrapped) return null;
		const attackerHp = Math.max(1, attacker.hp);
		const targetHp = Math.max(1, target.hp);
		const bestDamage = evaluations.reduce((max, entry) => Math.max(max, entry.damage), 0);
		const incoming = this.estimateIncomingDamage(target, attacker, battleState);
		if (incoming >= attackerHp && bestDamage < targetHp * 0.5) {
			return 'evitar ser debilitado';
		}
		if (bestDamage < targetHp * 0.3 && incoming > attackerHp * 0.4) {
			return 'encontrar un mejor enfrentamiento defensivo';
		}
		if (attacker.status === 'tox' && attacker.hp < attacker.maxhp / 2 && incoming > attackerHp * 0.25) {
			return 'mitigar el progreso del tóxico';
		}
		if (bestDamage <= 0 && incoming > attackerHp * 0.2) {
			return 'no tengo herramientas ofensivas útiles';
		}
		return null;
	}

	private chooseBestSwitch(
		side: Side,
		active: Pokemon,
		foe: Pokemon,
		battleState: string,
		excluded: Set<Pokemon> = new Set(),
	): { command: string; pokemon: Pokemon } | null {
		const candidates = side.pokemon.filter(poke => (
			poke &&
			!poke.fainted &&
			!poke.isActive &&
			!excluded.has(poke)
		));
		let best: { pokemon: Pokemon; score: number } | null = null;
		for (const candidate of candidates) {
			if (!candidate.hp) continue;
			const incoming = this.estimateIncomingDamage(foe, candidate, battleState);
			const damage = this.estimateMaxDamage(candidate, foe, battleState);
			const net = damage - incoming;
			if (!best || net > best.score) {
				best = { pokemon: candidate, score: net };
			}
		}
		if (!best) return null;
		const slotIndex = side.pokemon.indexOf(best.pokemon);
		if (slotIndex < 0) return null;
		return { command: `switch ${slotIndex + 1}`, pokemon: best.pokemon };
	}

	private chooseFallbackSwitch(
		side: Side,
		excluded: Set<Pokemon> = new Set(),
	): { command: string; pokemon: Pokemon } | null {
		for (let i = 0; i < side.pokemon.length; i++) {
			const candidate = side.pokemon[i];
			if (!candidate || candidate.fainted || candidate.isActive || excluded.has(candidate)) continue;
			if (!candidate.hp) continue;
			return { command: `switch ${i + 1}`, pokemon: candidate };
		}
		return null;
	}

	private estimateIncomingDamage(attacker: Pokemon, target: Pokemon, battleState: string): number {
		if (!attacker?.moveSlots?.length) return 0;
		let maxDamage = 0;
		for (const moveSlot of attacker.moveSlots) {
			if (!moveSlot || moveSlot.disabled === true) continue;
			const moveId = moveSlot.id || Dex.toID(moveSlot.move);
			if (!moveId) continue;
			const damage = this.simulateDamage(attacker, target, moveId, battleState);
			if (damage > maxDamage) maxDamage = damage;
		}
		return maxDamage;
	}

	private estimateMaxDamage(attacker: Pokemon, target: Pokemon, battleState: string): number {
		if (!attacker?.moveSlots?.length) return 0;
		let maxDamage = 0;
		for (const moveSlot of attacker.moveSlots) {
			if (!moveSlot || moveSlot.disabled === true) continue;
			const moveId = moveSlot.id || Dex.toID(moveSlot.move);
			if (!moveId) continue;
			const damage = this.simulateDamage(attacker, target, moveId, battleState);
			if (damage > maxDamage) maxDamage = damage;
		}
		return maxDamage;
	}

	private logSwitchChoice(current: Pokemon, incoming: Pokemon, foe: Pokemon, reason: string) {
		if (!this.options.logger) return;
		const currentName = current.species?.name || current.name || current.fullname || 'Tu Pokémon';
		const incomingName = incoming.species?.name || incoming.name || incoming.fullname || 'aliado';
		const foeName = foe.species?.name || foe.name || foe.fullname || 'el rival';
		this.options.logger(`[IntegratedSmartAI] ${currentName} cambiará a ${incomingName} para ${reason} frente a ${foeName}`);
	}

	private logTeamSnapshots(side: Side) {
		if (!this.options.logger) return;
		const playerSnapshot = this.serializeTeam(side.foe);
		const foeSnapshot = this.serializeTeam(side);
		this.options.logger(`Tus Pokémon: ${JSON.stringify(playerSnapshot)}`);
		this.options.logger(`Pokémon rivales: ${JSON.stringify(foeSnapshot)}`);
	}

	private serializeTeam(side: Side): TeamSnapshotEntry[] {
		return side.pokemon.map(pokemon => this.serializePokemon(pokemon));
	}

	private serializePokemon(pokemon: Pokemon): TeamSnapshotEntry {
		const condition = pokemon.getHealth().secret;
		const currentHp = Math.max(0, pokemon.hp);
		const resolvedMaxHp = pokemon.maxhp || pokemon.baseMaxhp || 0;
		const maxHp = resolvedMaxHp > 0 ? resolvedMaxHp : null;
		const moves = pokemon.moveSlots.map(slot => slot.move);
		return {
			ident: pokemon.fullname,
			details: pokemon.details,
			level: pokemon.level,
			stats: pokemon.baseStoredStats ?? null,
			condition,
			currentHp,
			maxHp,
			moves,
		};
	}

	private logEvaluation(attacker: Pokemon, target: Pokemon, evaluations: MoveEvaluation[]) {
		if (!this.options.logger) return;
		const attackerName = attacker.species?.name || attacker.name || attacker.fullname || 'Desconocido';
		const targetName = target.species?.name || target.name || target.fullname || 'Objetivo';
		const payload = evaluations.map(entry => ({
			nombre: entry.name,
			tipo: entry.type,
			categoria: entry.category,
			daño: entry.damage,
			score: Number(entry.score.toFixed(2)),
			precision: entry.accuracy,
			estado: entry.status,
			efectos: entry.effects,
			estadoInfo: entry.statusInfo?.map(info => ({
				estado: info.status,
				chance: info.chance,
				aplica: info.applies,
			})) ?? null,
			apoyos: entry.supportTags ?? null,
		}));
		const message = `[IntegratedSmartAI] ${attackerName} evalúa a ${targetName}: ${JSON.stringify(payload)}`;
		this.options.logger(message);
	}

	private describeMoveEffects(move: AnyObject): { status: string | null; effects: string[] } {
		let inflictedStatus: string | null = move.status ? this.prettyStatus(move.status) : null;
		const effects: string[] = [];

		const formatBoost = (stat: string, amount: number, target: 'self' | 'foe') => {
			const label = target === 'self' ? 'al usuario' : 'al objetivo';
			const verb = amount > 0 ? 'aumenta' : 'reduce';
			effects.push(`${verb} ${label} ${this.formatStatName(stat)} ${amount > 0 ? '+' : ''}${amount}`);
		};

		const applyBoosts = (boosts: AnyObject | undefined | null, target: 'self' | 'foe') => {
			if (!boosts) return;
			for (const stat in boosts) {
				const amount = boosts[stat];
				if (!amount) continue;
				formatBoost(stat, amount, target);
			}
		};

		applyBoosts(move.boosts, move.target === 'self' ? 'self' : 'foe');
		if (move.self?.boosts) applyBoosts(move.self.boosts, 'self');

		const handleSecondary = (secondary: AnyObject | undefined | null) => {
			if (!secondary) return;
			if (secondary.status) {
				const pretty = this.prettyStatus(secondary.status);
				inflictedStatus = inflictedStatus ?? pretty;
				effects.push(`puede causar ${pretty}`);
			}
			if (secondary.volatileStatus) {
				effects.push(`aplica ${secondary.volatileStatus}`);
			}
			if (secondary.sideCondition) {
				effects.push(`coloca ${secondary.sideCondition}`);
			}
			applyBoosts(secondary.boosts, 'foe');
			if (secondary.self?.boosts) applyBoosts(secondary.self.boosts, 'self');
		};

		if (Array.isArray(move.secondaries)) {
			for (const sec of move.secondaries) handleSecondary(sec);
		} else {
			handleSecondary(move.secondary);
		}

		if (move.drain) effects.push('drena PS del objetivo');
		if (move.recoil) effects.push('causa retroceso al usuario');
		if (move.heal) effects.push('cura al usuario');
		if (move.forceSwitch) effects.push('obliga a cambiar al objetivo');
		if (move.priority > 0) effects.push('tiene prioridad');

		if (!effects.length && move.shortDesc) {
			effects.push(move.shortDesc);
		}

		return { status: inflictedStatus, effects };
	}

	private prettyStatus(statusId: string): string {
		const id = Dex.toID(statusId);
		switch (id) {
			case 'brn': return 'Quemadura';
			case 'par': return 'Parálisis';
			case 'psn': return 'Envenenamiento';
			case 'tox': return 'Envenenamiento grave';
			case 'slp': return 'Sueño';
			case 'frz': return 'Congelación';
			default: return statusId;
		}
	}

	private formatStatName(statId: string): string {
		switch (statId) {
			case 'atk': return 'Ataque';
			case 'def': return 'Defensa';
			case 'spa': return 'Ataque Especial';
			case 'spd': return 'Defensa Especial';
			case 'spe': return 'Velocidad';
			case 'accuracy': return 'Precisión';
			case 'evasion': return 'Evasión';
			default: return statId;
		}
	}

	private logChosenMove(attacker: Pokemon, target: Pokemon, move: MoveEvaluation) {
		if (!this.options.logger) return;
		const attackerName = attacker.species?.name || attacker.name || attacker.fullname || 'Desconocido';
		const targetName = target.species?.name || target.name || target.fullname || 'Objetivo';
		const message = `[IntegratedSmartAI] ${attackerName} usará ${move.name} contra ${targetName} (daño estimado ${move.damage}, precisión ${move.accuracy ?? '??'}%)`;
		this.options.logger(message);
	}
}

function isSwitchRequest(request: ChoiceRequest): request is SwitchRequest {
	return Array.isArray((request as SwitchRequest).forceSwitch);
}

function isMoveRequest(request: ChoiceRequest): request is MoveRequest {
	// ChoiceRequest discriminated union
	return (request as MoveRequest).active !== undefined;
}

function isTeamPreviewRequest(request: ChoiceRequest): request is TeamPreviewRequest {
	return !!(request as TeamPreviewRequest).teamPreview;
}
