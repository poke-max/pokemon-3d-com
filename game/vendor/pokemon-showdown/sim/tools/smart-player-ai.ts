/**
 * Super-effective leaning player AI.
 *
 * Prefers the highest base-power move with the best type match-up,
 * falling back to random choices when no data is available.
 *
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * @license MIT
 */

import type { ObjectReadWriteStream } from '../../lib/streams';
import { BattlePlayer } from '../battle-stream';
import { Dex } from '../dex';
import { PRNG, type PRNGSeed } from '../prng';
import type { ChoiceRequest, MoveRequest } from '../side';

type PlayerSlotID = 'p1' | 'p2' | 'p3' | 'p4';
type PreferredStat = 'atk' | 'spa';
type StatBlock = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
type OpponentInfo = {
	types: string[];
	name: string | null;
	slot?: string;
	stats?: StatBlock;
	boosts?: AnyObject | null;
	status?: string | null;
	ability?: string | null;
	item?: string | null;
	currentHp?: number;
	maxHp?: number;
	level?: number;
};
type EvaluatedMove = {
	moveName: string;
	score: number;
	effectiveness: number;
	basePower: number;
	category: 'Physical' | 'Special' | 'Status';
	type: string;
	accuracy: number;
	boostsStat: PreferredStat | null;
	estimatedDamage: number;
	minDamage: number;
	maxDamage: number;
	status: string | null;
	effects: string[];
};

interface SmartAIOptions {
	move?: number;
	mega?: number;
	seed?: PRNG | PRNGSeed | null;
	logger?: (message: string) => void;
}

export class SmartPlayerAI extends BattlePlayer {
	protected readonly move: number;
	protected readonly mega: number;
	protected readonly prng: PRNG;
	private readonly logger?: (message: string) => void;
	private sideId: PlayerSlotID | null = null;
	private foeSideIds: PlayerSlotID[] = [];
	private foeSlotInfo: Record<string, OpponentInfo> = {};
	private activeFoeSlots = new Set<string>();
	private knownTeam: Record<string, { name: string | null; moves: string[] }> = {};
	private playerSlotInfo: Record<string, { currentHp?: number; maxHp?: number; condition?: string }> = {};
	private lastPlayerSnapshot: AnyObject[] | null = null;
	private lastFoeSnapshot: AnyObject[] | null = null;

	constructor(
		playerStream: ObjectReadWriteStream<string>,
		options: SmartAIOptions = {},
		debug = false,
	) {
		super(playerStream, debug);
		this.move = options.move || 1.0;
		this.mega = options.mega || 0;
		this.prng = PRNG.get(options.seed);
		this.logger = options.logger;
	}

	override receiveError(error: Error) {
		if (error.message.startsWith('[Unavailable choice]')) return;
		throw error;
	}

	override receiveLine(line: string) {
		if (line.startsWith('|')) {
			const parts = line.split('|');
			const cmd = parts[1];
			if (cmd === 'switch' || cmd === 'drag' || cmd === 'detailschange') {
				this.trackFoeFromLine(parts[2] ?? '', parts[3]);
				this.trackPlayerFromLine(parts[2] ?? '', parts[3], parts[4]);
			} else if (cmd === 'faint') {
				this.handleFoeFaint(parts[2] ?? '');
				this.handlePlayerFaint(parts[2] ?? '');
			} else if (cmd === '-damage' || cmd === '-heal') {
				this.trackPlayerHpEvent(parts[2] ?? '', parts[3]);
			} else if (cmd === 'turn') {
				const turnNumber = parseInt(parts[2] ?? '', 10);
				if (Number.isNaN(turnNumber) || turnNumber > 1) {
					this.logDebug(`turn ${Number.isNaN(turnNumber) ? 'unknown' : turnNumber} detected; replaying snapshots`);
					this.emitCachedTeamSnapshots();
				}
			} else if (cmd === 'win' || cmd === 'tie') {
				this.logDebug('battle end detected; replaying snapshots');
				this.emitCachedTeamSnapshots();
			}
		}
		super.receiveLine(line);
	}

	override receiveRequest(request: ChoiceRequest) {
		if ('side' in request && request.side?.id && !this.sideId) {
			this.assignSideId(request.side.id as PlayerSlotID);
		}
		if ('side' in request && request.side?.pokemon?.length) {
			const playerPokemon = request.side.pokemon as AnyObject[];
			this.storeTeamKnowledge(playerPokemon);
			this.logPlayerState(playerPokemon);
		}
		const moveRequest = this.isMoveRequest(request) ? request : null;
		const foeInfos = moveRequest ? this.getActiveFoes(moveRequest) : [];
		if (moveRequest?.foe?.pokemon?.length) {
			this.logFoeState(moveRequest.foe.pokemon as AnyObject[]);
		} else if (foeInfos.length) {
			this.logOpponentInfoState(foeInfos);
		}
		if (request.wait) {
			return;
		} else if (request.forceSwitch) {
			const pokemon = request.side.pokemon;
			const chosen: number[] = [];
			const choices = request.forceSwitch.map((mustSwitch, i) => {
				if (!mustSwitch) return `pass`;
				const canSwitch = range(1, 6).filter(j => (
					pokemon[j - 1] &&
					(j > request.forceSwitch.length || pokemon[i].reviving) &&
					!chosen.includes(j) &&
					!pokemon[j - 1].condition.endsWith(' fnt') === !pokemon[i].reviving
				));
				if (!canSwitch.length) return `pass`;
				const target = this.chooseSwitch(
					undefined,
					canSwitch.map(slot => ({ slot, pokemon: pokemon[slot - 1] })),
				);
				chosen.push(target);
				return `switch ${target}`;
			});
			this.choose(choices.join(', '));
		} else if (request.teamPreview) {
			this.choose(this.chooseTeamPreview(request.side.pokemon));
		} else if (request.active) {
			let [canMegaEvo, canUltraBurst, canZMove, canDynamax, canTerastallize] = [true, true, true, true, true];
			const pokemon = request.side.pokemon;
			const chosen: number[] = [];
			const choices = request.active.map((active: AnyObject, i: number) => {
				if (pokemon[i].condition.endsWith(' fnt') || pokemon[i].commanding) return 'pass';

				canMegaEvo = canMegaEvo && active.canMegaEvo;
				canUltraBurst = canUltraBurst && active.canUltraBurst;
				canZMove = canZMove && !!active.canZMove;
				canDynamax = canDynamax && !!active.canDynamax;
				canTerastallize = canTerastallize && !!active.canTerastallize;

				const change = (canMegaEvo || canUltraBurst || canDynamax) && this.prng.random() < this.mega;
				const useMaxMoves = (!active.canDynamax && active.maxMoves) || (change && canDynamax);
				const possibleMoves = useMaxMoves ? active.maxMoves.maxMoves : active.moves;

				let canMove = range(1, possibleMoves.length).filter(j => !possibleMoves[j - 1].disabled)
					.map(j => ({
						slot: j,
						move: possibleMoves[j - 1],
						target: possibleMoves[j - 1].target,
						zMove: false,
					}));

				if (canZMove) {
					canMove.push(...range(1, active.canZMove.length)
						.filter(j => active.canZMove[j - 1])
						.map(j => ({
							slot: j,
							move: active.canZMove![j - 1],
							target: active.canZMove![j - 1].target,
							zMove: true,
						})));
				}

				const hasAlly = pokemon.length > 1 && !pokemon[i ^ 1].condition.endsWith(' fnt');
				const filtered = canMove.filter(m => m.target !== 'adjacentAlly' || hasAlly);
				canMove = filtered.length ? filtered : canMove;

				const moves = canMove.map(m => {
					let move = `move ${m.slot}`;
					if (request.active!.length > 1) {
						if (['normal', 'any', 'adjacentFoe'].includes(m.target)) {
							move += ` ${1 + this.prng.random(2)}`;
						}
						if (m.target === 'adjacentAlly') {
							move += ` -${(i ^ 1) + 1}`;
						}
						if (m.target === 'adjacentAllyOrSelf') {
							if (hasAlly) {
								move += ` -${1 + this.prng.random(2)}`;
							} else {
								move += ` -${i + 1}`;
							}
						}
					}
					if (m.zMove) move += ' zmove';
					return { choice: move, move: m.move };
				});

				const canSwitch = range(1, 6).filter(j => (
					pokemon[j - 1] &&
					!pokemon[j - 1].active &&
					!chosen.includes(j) &&
					!pokemon[j - 1].condition.endsWith(' fnt')
				));
				const switches = active.trapped ? [] : canSwitch;

				if (switches.length && (!moves.length || this.prng.random() > this.move)) {
					const target = this.chooseSwitch(
						active,
						canSwitch.map(slot => ({ slot, pokemon: pokemon[slot - 1] })),
					);
					chosen.push(target);
					return `switch ${target}`;
				} else if (moves.length) {
					const allyInfo = pokemon[i];
					const move = this.chooseMove(active, moves, foeInfos, allyInfo);
					if (move.endsWith(' zmove')) {
						canZMove = false;
						return move;
					} else if (change) {
						if (canTerastallize) {
							canTerastallize = false;
							return `${move} terastallize`;
						} else if (canDynamax) {
							canDynamax = false;
							return `${move} dynamax`;
						} else if (canMegaEvo) {
							canMegaEvo = false;
							return `${move} mega`;
						} else {
							canUltraBurst = false;
							return `${move} ultra`;
						}
					} else {
						return move;
					}
				} else {
					throw new Error(`${this.constructor.name} unable to make choice ${i}. request='${typeof request}', chosen='${chosen}'`);
				}
			});
			this.choose(choices.join(', '));
		}
	}

	protected chooseTeamPreview(team: AnyObject[]): string {
		return 'default';
	}

	protected chooseMove(active: AnyObject, moves: { choice: string; move: AnyObject }[], foeInfos: OpponentInfo[], allyInfo: AnyObject): string {
		const allyTypes = this.getTypesFromPokemonInfo(allyInfo);
		const evaluations = moves.map(option => ({
			choice: option.choice,
			...this.evaluateMove(option.move, foeInfos, allyTypes, allyInfo),
		})) as Array<EvaluatedMove & { choice: string }>;

		if (!evaluations.length) {
			const fallback = this.prng.sample(moves).choice;
			this.reportDecision(allyInfo, null, fallback, 'sin movimientos disponibles');
			return fallback;
		}

		const damageCandidates = evaluations.filter(entry => entry.category !== 'Status');
		const preferredStat = this.determinePreferredStat(damageCandidates);
		const targetInfo = foeInfos[0];
		const targetName = targetInfo?.name ?? null;
		const targetHp = targetInfo?.currentHp ?? targetInfo?.maxHp ?? null;
		this.logMoveEvaluations(allyInfo, evaluations, targetName);

		if (targetHp !== null) {
			const koCandidates = damageCandidates.filter(entry => entry.minDamage >= targetHp);
			if (koCandidates.length) {
				const bestAccuracy = koCandidates.reduce((best, current) => (
					current.accuracy > best.accuracy ? current : best
				));
				this.reportDecision(
					allyInfo,
					targetName,
					bestAccuracy.moveName,
					`garantiza KO con ${bestAccuracy.accuracy.toFixed(0)}% de precisión`,
				);
				return evaluations.find(entry => entry.moveName === bestAccuracy.moveName)?.choice ?? moves[0].choice;
			}
		}

		const bestDamage: EvaluatedMove & { choice: string } = damageCandidates.length
			? damageCandidates.reduce((best, current) => (current.estimatedDamage > best.estimatedDamage ? current : best))
			: evaluations[0];

		if (targetHp !== null && bestDamage) {
			const ratio = bestDamage.minDamage / Math.max(1, targetHp);
			this.logDamageCategory(allyInfo, targetName, bestDamage.moveName, ratio);
			if (ratio < 0.5) {
				const boostingMove = evaluations.find(entry => entry.boostsStat && entry.boostsStat === preferredStat);
				if (boostingMove) {
					this.reportDecision(
						allyInfo,
						targetName,
						boostingMove.moveName,
						`mejorar su ${boostingMove.boostsStat === 'atk' ? 'Ataque' : 'Ataque Especial'}`,
					);
					return boostingMove.choice;
				}
			}
		}

		if (bestDamage.score > 0) {
			this.reportDecision(
				allyInfo,
				targetName,
				bestDamage.moveName,
				`daño estimado ${bestDamage.minDamage.toFixed(0)}-${bestDamage.maxDamage.toFixed(0)}`,
			);
			return bestDamage.choice;
		}
		this.reportDecision(allyInfo, targetName, bestDamage.moveName, 'sin ventaja clara');
		return bestDamage.choice;
	}

	protected chooseSwitch(active: AnyObject | undefined, switches: { slot: number; pokemon: AnyObject }[]): number {
		return this.prng.sample(switches).slot;
	}

	private evaluateMove(moveInfo: AnyObject, foes: OpponentInfo[], allyTypes: string[], allyInfo: AnyObject): EvaluatedMove {
		const moveName = moveInfo?.move || moveInfo?.id;
		const baseEval: EvaluatedMove = {
			moveName: moveName || 'unknown',
			score: 0,
			effectiveness: 1,
			basePower: 0,
			category: 'Status' as 'Physical' | 'Special' | 'Status',
			type: '???',
			accuracy: 100,
			boostsStat: null as PreferredStat | null,
			estimatedDamage: 0,
			minDamage: 0,
			maxDamage: 0,
			status: null,
			effects: [],
		};
		if (!moveName) return baseEval;
		const move = Dex.moves.get(moveName);
		if (!move.exists) return baseEval;

		const moveType = moveInfo.type ?? move.type ?? '???';
		const basePower = moveInfo.basePower ?? move.basePower ?? 0;
		const effectiveness = foes.length
			? foes.reduce((best, foe) => {
				const totalBoost = foe.types.reduce((acc, type) => acc + Dex.getEffectiveness(moveType, type), 0);
				const multiplier = totalBoost > 0 ? 2 ** totalBoost : totalBoost < 0 ? 0.5 ** (-totalBoost) : 1;
				return Math.max(best, multiplier);
			}, 1)
			: 1;
		const damageRange = this.estimateDamageRange(move, moveInfo, allyInfo, foes[0], allyTypes);
		const score = damageRange.average;
		const boostsStat: PreferredStat | null =
			move.boosts?.atk ? 'atk' :
				move.boosts?.spa ? 'spa' : null;

		const extra = this.describeMoveEffects(move);
		const accuracy = typeof move.accuracy === 'number' ? move.accuracy : 100;

		return {
			moveName: move.name,
			score,
			effectiveness,
			basePower: Math.max(basePower, 0),
			category: move.category as 'Physical' | 'Special' | 'Status',
			type: moveType,
			accuracy,
			boostsStat,
			estimatedDamage: damageRange.average,
			minDamage: damageRange.min,
			maxDamage: damageRange.max,
			status: extra.status,
			effects: extra.effects,
		};
	}

	private determinePreferredStat(evaluations: EvaluatedMove[]): PreferredStat {
		if (!evaluations.length) return 'atk';
		const strongest = evaluations.reduce((best, current) => (
			current.basePower > best.basePower ? current : best
		));
		if (strongest.category === 'Special') return 'spa';
		return 'atk';
	}

	private isMoveRequest(request: ChoiceRequest): request is MoveRequestWithFoe {
		return 'active' in request;
	}

	private getActiveFoes(request: ChoiceRequest): OpponentInfo[] {
		if (!('active' in request)) return [];
		const moveRequest = request as MoveRequestWithFoe;
		const foes = moveRequest.foe?.pokemon ?? [];
		const activeFoes = foes.filter((p: AnyObject) => p.active);
		if (!activeFoes.length && foes.length) {
			activeFoes.push(foes[0]);
		}
		const fromRequest = activeFoes
			.map((p: AnyObject) => {
				const name = this.getSpeciesName(p);
				const stats = this.extractStats(p, name);
				const { currentHp, maxHp } = this.parseCondition(p.condition);
				return {
					name,
					types: this.getTypesFromPokemonInfo(p),
					slot: p.ident?.split(':')[0]?.trim(),
					stats,
					boosts: p.boosts ?? null,
					status: this.getStatusFromInfo(p),
					ability: p.ability ?? null,
					item: p.item ?? null,
					currentHp: currentHp ?? p.hp ?? undefined,
					maxHp: maxHp ?? p.maxhp ?? undefined,
					level: p.level ?? 50,
				};
			})
			.filter(entry => entry.types.length);
		if (fromRequest.length) return fromRequest;
		const fallback = Array.from(this.activeFoeSlots)
			.map(slot => this.foeSlotInfo[slot])
			.filter((info): info is OpponentInfo => !!info && info.types.length > 0);
		return fallback;
	}

	private getTypesFromPokemonInfo(info: AnyObject | undefined): string[] {
		if (!info) return [];
		const speciesName = this.getSpeciesName(info);
		if (!speciesName) return [];
		const species = Dex.species.get(speciesName);
		return species.exists ? species.types : [];
	}

	private getSpeciesName(info: AnyObject): string | null {
		const details: string | undefined = info.details;
		if (details) {
			const [name] = details.split(',');
			if (name) return name.trim();
		}
		const ident: string | undefined = info.ident;
		if (ident) {
			const colon = ident.indexOf(':');
			return (colon >= 0 ? ident.slice(colon + 1) : ident).trim() || null;
		}
		return info.species ?? null;
	}

	private getStatusFromInfo(info: AnyObject | undefined): string | null {
		if (!info) return null;
		if (typeof info.status === 'string' && info.status.length) return info.status;
		const condition: string | undefined = info.condition;
		if (!condition || !condition.includes(' ')) return null;
		const parts = condition.trim().split(' ');
		const status = parts.length > 1 ? parts[parts.length - 1] : null;
		if (!status) return null;
		if (/^\d+\/\d+$/.test(status)) return null;
		if (/^\d+%$/.test(status)) return null;
		return status;
	}

	private assignSideId(id: PlayerSlotID) {
		this.sideId = id;
		this.foeSideIds = this.getOpposingSides(id);
	}

	private getOpposingSides(id: PlayerSlotID): PlayerSlotID[] {
		switch (id) {
			case 'p1': return ['p2'];
			case 'p2': return ['p1'];
			case 'p3': return ['p4'];
			case 'p4': return ['p3'];
			default: return [];
		}
	}

	private trackFoeFromLine(identSegment: string, detailsSegment?: string) {
		const slot = identSegment.split(':')[0]?.trim() ?? '';
		if (!slot || !this.isFoeSlot(slot)) return;
		const speciesName = this.extractSpeciesName(detailsSegment) ?? identSegment.split(':')[1]?.trim();
		if (!speciesName) return;
		const species = Dex.species.get(speciesName);
		if (!species.exists) return;
		this.foeSlotInfo[slot] = {
			types: species.types,
			name: species.name,
			slot,
			stats: this.extractStats(undefined, species.name),
			level: 50,
		};
		this.activeFoeSlots.add(slot);
	}

	private handleFoeFaint(identSegment: string) {
		const slot = identSegment.split(':')[0]?.trim() ?? '';
		if (!slot || !this.isFoeSlot(slot)) return;
		this.activeFoeSlots.delete(slot);
		delete this.foeSlotInfo[slot];
	}

	private trackPlayerFromLine(identSegment: string, detailsSegment?: string, conditionSegment?: string) {
		const slot = identSegment.split(':')[0]?.trim() ?? '';
		if (!slot) return;
		const { currentHp, maxHp } = this.parseCondition(conditionSegment ?? '');
		this.playerSlotInfo[slot] = {
			currentHp: currentHp ?? this.playerSlotInfo[slot]?.currentHp,
			maxHp: maxHp ?? this.playerSlotInfo[slot]?.maxHp,
			condition: conditionSegment ?? this.playerSlotInfo[slot]?.condition,
		};
	}

	private trackPlayerHpEvent(identSegment: string, conditionSegment?: string) {
		const slot = identSegment.split(':')[0]?.trim() ?? '';
		if (!slot) return;
		const { currentHp, maxHp } = this.parseCondition(conditionSegment ?? '');
		const existing = this.playerSlotInfo[slot] ?? {};
		this.playerSlotInfo[slot] = {
			currentHp: currentHp ?? existing.currentHp,
			maxHp: maxHp ?? existing.maxHp,
			condition: conditionSegment ?? existing.condition,
		};
	}

	private handlePlayerFaint(identSegment: string) {
		const slot = identSegment.split(':')[0]?.trim() ?? '';
		if (!slot) return;
		const existing = this.playerSlotInfo[slot] ?? {};
		this.playerSlotInfo[slot] = {
			currentHp: 0,
			maxHp: existing.maxHp,
			condition: '0 fnt',
		};
	}

	private extractSpeciesName(details?: string): string | null {
		if (!details) return null;
		const [name] = details.split(',');
		return name?.trim() || null;
	}

	private isFoeSlot(slot: string): boolean {
		if (!slot.length || !this.foeSideIds.length) return false;
		const sideId = slot.slice(0, 2) as PlayerSlotID;
		return this.foeSideIds.includes(sideId);
	}

	private reportDecision(attackerInfo: AnyObject, targetName: string | null, moveName: string, reason: string) {
		const attackerName = this.getSpeciesName(attackerInfo) ?? attackerInfo?.name ?? 'El oponente';
		const foeName = targetName ?? 'tu Pokémon';
		const message = `${attackerName} identificó a ${foeName}, usará ${moveName}${reason ? ` (${reason})` : ''}.`;
		this.log.push(`|ai|${message}`);
		this.logger?.(message);
		console.info(`[SmartAI] ${message}`);
	}

	private estimateDamageRange(
		move: typeof Dex.moves.get extends (...args: any) => infer R ? R : never,
		moveInfo: AnyObject,
		attackerInfo: AnyObject,
		foe: OpponentInfo | undefined,
		allyTypes: string[],
	) {
		if (!foe || move.category === 'Status') return { min: 0, max: 0, average: 0 };
		const level = attackerInfo?.level ?? 50;
		const moveType = moveInfo.type ?? move.type;
		let basePower = moveInfo.basePower ?? move.basePower ?? 0;
		if (move.damage === 'level') {
			const fixed = level;
			return { min: fixed, max: fixed, average: fixed };
		}
		if (typeof move.damage === 'number') {
			const fixed = move.damage;
			return { min: fixed, max: fixed, average: fixed };
		}
		if (move.ohko) {
			const ohkoDamage = Math.max(foe.currentHp ?? foe.maxHp ?? 0, 0);
			return { min: ohkoDamage, max: ohkoDamage, average: ohkoDamage };
		}
		if (basePower <= 0) return { min: 0, max: 0, average: 0 };

		const offensiveStatName = this.getOffensiveStatName(move);
		const defensiveStatName = this.getDefensiveStatName(move);

		const attackerStats = this.extractStats(attackerInfo);
		const defenderStats = foe.stats ?? this.extractStats(undefined, foe.name);
		let attackStat = attackerStats[offensiveStatName as keyof StatBlock] ?? 100;
		let defenseStat = defenderStats[defensiveStatName as keyof StatBlock] ?? 100;

		attackStat = this.applyBoost(attackStat, this.getBoost(attackerInfo, offensiveStatName));
		defenseStat = this.applyBoost(defenseStat, this.getBoost(foe, defensiveStatName));

		if (move.overrideOffensiveStat === 'def') {
			attackStat = this.applyBoost(attackerStats.def, this.getBoost(attackerInfo, 'def'));
		} else if (move.overrideOffensiveStat === 'spd') {
			attackStat = this.applyBoost(attackerStats.spd, this.getBoost(attackerInfo, 'spd'));
		}
		if (move.overrideDefensiveStat === 'atk') {
			defenseStat = this.applyBoost(defenderStats.atk, this.getBoost(foe, 'atk'));
		} else if (move.overrideDefensiveStat === 'spa') {
			defenseStat = this.applyBoost(defenderStats.spa, this.getBoost(foe, 'spa'));
		}

		if (move.category === 'Physical' && this.isBurned(attackerInfo) && !this.ignoreBurnModifier(attackerInfo)) {
			attackStat = Math.floor(attackStat / 2);
		}

		const stab = allyTypes.includes(moveType) ? 1.5 : 1;
		const effectiveness = foe.types.reduce((total, type) => {
			const eff = Dex.getEffectiveness(moveType, type);
			return total + eff;
		}, 0);
		const typeModifier = effectiveness > 0 ? 2 ** effectiveness : effectiveness < 0 ? 0.5 ** (-effectiveness) : 1;

		const base =
			Math.floor(
				Math.floor(
					Math.floor((2 * level) / 5 + 2) * basePower * Math.max(1, attackStat) / Math.max(1, defenseStat),
				) / 50,
			) + 2;

		const { minHits, maxHits, avgHits } = this.getMultiHitInfo(move, moveInfo);
		const hasVariance = !move.noDamageVariance;
		const minRandom = hasVariance ? 0.85 : 1;
		const maxRandom = 1;

		let minDamage = Math.floor(base * stab * typeModifier * minRandom) * minHits;
		let maxDamage = Math.floor(base * stab * typeModifier * maxRandom) * maxHits;
		let average = Math.round(base * stab * typeModifier * ((minRandom + maxRandom) / 2) * avgHits);

		const targetHp = foe.currentHp ?? foe.maxHp ?? null;
		if (targetHp !== null) {
			minDamage = Math.min(minDamage, targetHp);
			maxDamage = Math.min(maxDamage, targetHp);
			average = Math.min(average, targetHp);
		}

		return {
			min: Math.max(0, minDamage),
			max: Math.max(0, maxDamage),
			average: Math.max(0, average),
		};
	}

	private extractStats(info?: AnyObject | null, speciesHint?: string | null): StatBlock {
		const stats = info?.stats ?? info?.baseStats;
		if (stats) return this.normalizeStats(stats);
		const name = speciesHint ?? this.getSpeciesName(info);
		if (name) {
			const species = Dex.species.get(name);
			if (species.exists) return this.normalizeStats(species.baseStats);
		}
		return { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
	}

	private normalizeStats(stats: AnyObject): StatBlock {
		return {
			hp: stats.hp ?? 100,
			atk: stats.atk ?? 100,
			def: stats.def ?? 100,
			spa: stats.spa ?? stats.spd ?? 100,
			spd: stats.spd ?? stats.spa ?? 100,
			spe: stats.spe ?? 100,
		};
	}

	private parseCondition(condition?: string): { currentHp: number | null; maxHp: number | null } {
		if (!condition) return { currentHp: null, maxHp: null };
		if (condition.includes('/')) {
			const [currentPart, rest] = condition.split('/');
			const current = parseInt(currentPart, 10);
			const maxPart = rest.split(' ')[0];
			const max = parseInt(maxPart, 10);
			return {
				currentHp: Number.isNaN(current) ? null : current,
				maxHp: Number.isNaN(max) ? null : max,
			};
		}
		if (condition.endsWith('%')) {
			const percent = parseInt(condition, 10);
			if (Number.isNaN(percent)) return { currentHp: null, maxHp: null };
			return { currentHp: percent, maxHp: 100 };
		}
		const numeric = parseInt(condition, 10);
		if (!Number.isNaN(numeric)) return { currentHp: numeric, maxHp: null };
		return { currentHp: null, maxHp: null };
	}

	private storeTeamKnowledge(pokemonList: AnyObject[]) {
		for (const pokemon of pokemonList) {
			const name = this.getSpeciesName(pokemon);
			const ident = pokemon.ident ?? name;
			if (!ident) continue;
			const moves = Array.isArray(pokemon.moves)
				? pokemon.moves.map((entry: AnyObject) => {
					if (typeof entry === 'string') return entry;
					return entry.move ?? entry.id ?? entry.name;
				}).filter(Boolean)
				: [];
			this.knownTeam[ident] = { name, moves };
		}
	}

	private logPlayerState(pokemonList: AnyObject[]) {
		const snapshot = pokemonList.map(pokemon => {
			const { currentHp, maxHp } = this.parseCondition(pokemon.condition);
			return {
				ident: pokemon.ident,
				details: pokemon.details,
				level: pokemon.level ?? 50,
				stats: pokemon.stats ?? pokemon.baseStats ?? null,
				condition: this.resolvePlayerCondition(pokemon.ident, pokemon.condition, currentHp, maxHp),
				currentHp: this.resolvePlayerHp(pokemon.ident, currentHp ?? pokemon.hp ?? null, 'current'),
				maxHp: this.resolvePlayerHp(pokemon.ident, maxHp ?? pokemon.maxhp ?? null, 'max'),
				moves: pokemon.moves?.map((entry: AnyObject) => (
					typeof entry === 'string' ? entry : entry.move ?? entry.id ?? entry.name
				)) ?? [],
			};
		});
		
		this.pushTeamSnapshot(true, snapshot);
	}

	private logFoeState(pokemonList: AnyObject[]) {
		const snapshot = pokemonList.map(pokemon => {
			const { currentHp, maxHp } = this.parseCondition(pokemon.condition);
			return {
				ident: pokemon.ident,
				details: pokemon.details,
				level: pokemon.level ?? 50,
				stats: pokemon.stats ?? pokemon.baseStats ?? null,
				condition: pokemon.condition,
				currentHp: currentHp ?? pokemon.hp ?? null,
				maxHp: maxHp ?? pokemon.maxhp ?? null,
				moves: pokemon.moves?.map((entry: AnyObject) => (
					typeof entry === 'string' ? entry : entry.move ?? entry.id ?? entry.name
				)) ?? [],
			};
		});
		this.pushTeamSnapshot(false, snapshot);
	}

	private logOpponentInfoState(foeInfos: OpponentInfo[]) {
		const snapshot = foeInfos.map(info => {
			const level = info.level ?? 50;
			const ident = info.slot ? `${info.slot}: ${info.name ?? '???'}` : info.name ?? '???';
			let condition = '???';
			if (typeof info.currentHp === 'number' && typeof info.maxHp === 'number') {
				condition = `${info.currentHp}/${info.maxHp}`;
			} else if (typeof info.currentHp === 'number') {
				condition = `${info.currentHp}`;
			} else if (typeof info.maxHp === 'number') {
				condition = `${info.maxHp}`;
			}
			return {
				ident,
				details: info.name ? `${info.name}, L${level}` : `Desconocido, L${level}`,
				level,
				stats: info.stats ?? null,
				condition,
				currentHp: info.currentHp ?? null,
				maxHp: info.maxHp ?? null,
				moves: [],
			};
		});
		this.pushTeamSnapshot(false, snapshot);
	}

	private getSlotFromIdent(ident?: string): PlayerSlotID | null {
		if (!ident || ident.length < 2) return null;
		const slot = ident.slice(0, 2) as PlayerSlotID;
		return ['p1', 'p2', 'p3', 'p4'].includes(slot) ? slot : null;
	}

	private pushTeamSnapshot(isPlayerTeam: boolean, snapshot: AnyObject[]) {
		this.storeTeamSnapshot(isPlayerTeam, snapshot);
		this.logTeamSnapshot(isPlayerTeam ? 'Tus Pokémon' : 'Pokémon rivales', snapshot);
	}

	private emitCachedTeamSnapshots() {
		this.logDebug('emitCachedTeamSnapshots called');
		const playerSnapshot = this.lastPlayerSnapshot;
		if (playerSnapshot?.length) {
			this.logTeamSnapshot('Tus Pokémon', playerSnapshot);
		} else {
			this.logDebug('no cached player snapshot to emit');
		}
		const foeSnapshot = this.lastFoeSnapshot;
		if (foeSnapshot?.length) {
			this.logTeamSnapshot('Pokémon rivales', foeSnapshot);
		} else {
			this.logDebug('no cached foe snapshot to emit');
		}
	}

	private logTeamSnapshot(label: string, snapshot: AnyObject[]) {
		const payload = JSON.stringify(snapshot);
		const message = `${label}: ${payload}`;
		this.log.push(`|smartai|${message}`);
		this.logger?.(message);
	}

	private logDebug(message: string) {
		const formatted = `[SmartAI] ${message}`;
		this.log.push(`|smartai|${formatted}`);
		this.logger?.(formatted);
		console.info(formatted);
	}

	private storeTeamSnapshot(isPlayerTeam: boolean, snapshot: AnyObject[]) {
		this.logDebug(`caching ${isPlayerTeam ? 'player' : 'foe'} snapshot (${snapshot.length} entries)`);
		const clone = snapshot.map(entry => ({
			...entry,
			stats: entry.stats ? { ...entry.stats } : null,
			moves: Array.isArray(entry.moves) ? [...entry.moves] : [],
		}));
		if (isPlayerTeam) {
			this.lastPlayerSnapshot = clone;
		} else {
			this.lastFoeSnapshot = clone;
		}
	}

	private resolvePlayerCondition(
		ident: string | undefined,
		original: string,
		currentHp: number | null,
		maxHp: number | null,
	) {
		if (original && !original.includes('???')) return original;
		const slot = this.getSlotFromIdent(ident ?? '');
		if (slot && this.playerSlotInfo[slot]?.condition) {
			return this.playerSlotInfo[slot]!.condition!;
		}
		if (currentHp !== null && maxHp !== null) return `${currentHp}/${maxHp}`;
		return original;
	}

	private resolvePlayerHp(
		ident: string | undefined,
		value: number | null,
		kind: 'current' | 'max',
	): number | null {
		if (value !== null) return value;
		const slot = this.getSlotFromIdent(ident ?? '');
		if (!slot) return null;
		const info = this.playerSlotInfo[slot];
		if (!info) return null;
		return kind === 'current'
			? info.currentHp ?? null
			: info.maxHp ?? null;
	}

	private logMoveEvaluations(
		attackerInfo: AnyObject,
		evaluations: Array<EvaluatedMove & { choice: string }>,
		targetName: string | null,
	) {
		if (!evaluations.length) return;
		const attackerName = this.getSpeciesName(attackerInfo) ?? attackerInfo?.name ?? 'El atacante';
		const foeName = targetName ?? 'el objetivo';
		const details = evaluations.map(entry => ({
			nombre: entry.moveName,
			tipo: entry.type,
			categoria: entry.category,
			daño: {
				min: Number(entry.minDamage.toFixed(1)),
				max: Number(entry.maxDamage.toFixed(1)),
			},
			score: Number(entry.score.toFixed(2)),
			precision: entry.accuracy,
			estado: entry.status,
			efectos: entry.effects,
		}));
		const payload = JSON.stringify({
			atacante: attackerName,
			objetivo: foeName,
			movimientos: details,
		});
		const message = `Evaluación de movimientos: ${payload}`;
		this.log.push(`|smartai|${message}`);
		this.logger?.(message);
	}

	private logDamageCategory(attackerInfo: AnyObject, targetName: string | null, moveName: string, ratio: number) {
		const attackerName = this.getSpeciesName(attackerInfo) ?? attackerInfo?.name ?? 'Tu Pokémon';
		const foeName = targetName ?? 'el objetivo';
		let categoria = 'menos de la mitad';
		if (ratio >= 1) categoria = 'un KO seguro';
		else if (ratio >= 0.5) categoria = 'más de la mitad de los PS';
		const message = `${attackerName} estima que ${moveName} hará ${categoria} contra ${foeName}.`;
		this.log.push(`|smartai|${message}`);
		this.logger?.(message);
	}

	private getOffensiveStatName(move: AnyObject): keyof StatBlock {
		if (move.overrideOffensiveStat === 'def') return 'def';
		if (move.overrideOffensiveStat === 'spd') return 'spd';
		if (move.overrideOffensiveStat === 'spa') return 'spa';
		if (move.overrideOffensiveStat === 'atk') return 'atk';
		return move.category === 'Special' ? 'spa' : 'atk';
	}

	private getDefensiveStatName(move: AnyObject): keyof StatBlock {
		if (move.overrideDefensiveStat === 'spd') return 'spd';
		if (move.overrideDefensiveStat === 'spa') return 'spa';
		if (move.overrideDefensiveStat === 'def') return 'def';
		if (move.overrideDefensiveStat === 'atk') return 'atk';
		return move.category === 'Special' ? 'spd' : 'def';
	}

	private getBoost(info: AnyObject | OpponentInfo | undefined, stat: keyof StatBlock): number {
		const boostSource = info?.boosts;
		if (!boostSource) return 0;
		const value = boostSource[stat];
		return typeof value === 'number' ? Math.max(-6, Math.min(6, value)) : 0;
	}

	private applyBoost(stat: number, stage: number | undefined): number {
		if (!stage) return stat;
		const clamped = Math.max(-6, Math.min(6, stage));
		if (clamped >= 0) return stat * (2 + clamped) / 2;
		return stat * 2 / Math.max(1, (2 - clamped));
	}

	private isBurned(info: AnyObject | OpponentInfo | undefined): boolean {
		return this.getStatusFromInfo(info as AnyObject) === 'brn';
	}

	private ignoreBurnModifier(info: AnyObject | OpponentInfo | undefined): boolean {
		return this.hasAbility(info, 'guts');
	}

	private hasAbility(info: AnyObject | OpponentInfo | undefined, abilityId: string): boolean {
		if (!info) return false;
		const ability = (info as AnyObject).ability ?? (info as OpponentInfo).ability;
		if (!ability) return false;
		return Dex.toID(ability) === Dex.toID(abilityId);
	}

	private getMultiHitInfo(move: AnyObject, moveInfo: AnyObject) {
		let minHits = 1;
		let maxHits = 1;
		let avgHits = 1;
		const multihit = moveInfo?.multihit ?? move.multihit;
		if (Array.isArray(multihit)) {
			minHits = multihit[0];
			maxHits = multihit[1];
			if (minHits === 2 && maxHits === 5) {
				avgHits = 3.125;
			} else {
				avgHits = (minHits + maxHits) / 2;
			}
		} else if (typeof multihit === 'number') {
			minHits = maxHits = avgHits = multihit;
		}
		return { minHits, maxHits, avgHits };
	}

	private describeMoveEffects(move: AnyObject): { status: string | null; effects: string[] } {
		let inflictedStatus: string | null = move.status ? this.prettyStatus(move.status) : null;
		const effects: string[] = [];
		const recordBoosts = (boosts: AnyObject | undefined | null, target: 'usuario' | 'objetivo') => {
			if (!boosts) return;
			for (const stat in boosts) {
				const amount = boosts[stat];
				if (!amount) continue;
				const verb = amount > 0 ? 'aumenta' : 'reduce';
				const targetLabel = target === 'usuario' ? 'al usuario' : 'al objetivo';
				const formatted = `${verb} ${targetLabel} ${this.formatStatName(stat)} ${amount > 0 ? '+' : ''}${amount}`;
				effects.push(formatted);
			}
		};

		const handleSecondary = (secondary: AnyObject | undefined | null) => {
			if (!secondary) return;
			if (!inflictedStatus && secondary.status) {
				inflictedStatus = this.prettyStatus(secondary.status);
			}
			if (secondary.status) {
				effects.push(`puede causar ${this.prettyStatus(secondary.status)}`);
			}
			if (secondary.volatileStatus) {
				effects.push(`aplica ${secondary.volatileStatus}`);
			}
			if (secondary.sideCondition) {
				effects.push(`coloca ${secondary.sideCondition}`);
			}
			recordBoosts(secondary.boosts, 'objetivo');
			if (secondary.self?.boosts) recordBoosts(secondary.self.boosts, 'usuario');
		};

		recordBoosts(move.boosts, move.target === 'self' ? 'usuario' : 'objetivo');
		if (move.self?.boosts) recordBoosts(move.self.boosts, 'usuario');

		if (Array.isArray(move.secondaries)) {
			for (const sec of move.secondaries) handleSecondary(sec);
		} else {
			handleSecondary(move.secondary);
		}

		if (move.drain) {
			effects.push('drena PS del objetivo');
		}
		if (move.recoil) {
			effects.push('causa retroceso al usuario');
		}
		if (move.heal) {
			effects.push('cura al usuario');
		}
		if (move.forceSwitch) {
			effects.push('obliga a cambiar al objetivo');
		}
		if (move.priority > 0) {
			effects.push('tiene prioridad');
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
}

function range(start: number, end?: number, step = 1) {
	if (end === undefined) {
		end = start;
		start = 0;
	}
	const result = [];
	for (; start <= end; start += step) {
		result.push(start);
	}
	return result;
}
type MoveRequestWithFoe = MoveRequest & { foe?: { pokemon: AnyObject[] } };
