import type { Dispatch, SetStateAction } from 'react';
import type { DexCatalogState } from '../hooks/useDexCatalog';
import type { TeamSelections, StatsTablePayload, DropdownOption } from '../types/battle';
import {
	applySpeciesDefaults,
	DEFAULT_LEVEL,
	DEFAULT_NATURE,
	getAbilityOptions,
	getAvailableGenders,
	getMoveOptions,
	NATURE_OPTIONS,
	padMoves,
	STAT_KEYS,
	STAT_LABELS,
} from '../utils/teamUtils';
import { SearchableDropdown } from './SearchableDropdown';

interface TeamBuilderProps {
	selections: TeamSelections;
	onChange: Dispatch<SetStateAction<TeamSelections>>;
	catalog: DexCatalogState | null;
	catalogStatus: 'loading' | 'ready' | 'error';
	speciesOptions: DropdownOption[];
	itemOptions: DropdownOption[];
	moveOptions: DropdownOption[];
	onStartManual: () => void;
	manualDisabled: boolean;
}

export function TeamBuilder({
	selections,
	onChange,
	catalog,
	catalogStatus,
	speciesOptions,
	itemOptions,
	moveOptions,
	onStartManual,
	manualDisabled,
}: TeamBuilderProps) {
	const speciesDropdownOptions = speciesOptions.length ? speciesOptions : [];

	const updateSlot = (side: 'p1' | 'p2', index: number, updater: (slot: TeamSelections['p1'][number]) => TeamSelections['p1'][number]) => {
		onChange(prev => {
			const next = { ...prev };
			const slots = [...next[side]];
			const current = slots[index];
			const updatedSlot = updater({ ...current, moves: [...current.moves] });
			if (!updatedSlot.moves || updatedSlot.moves.length < 4) {
				updatedSlot.moves = padMoves(updatedSlot.moves || [], current.moves);
			}
			slots[index] = updatedSlot;
			next[side] = slots;
			return next;
		});
	};

	const handleSpeciesChange = (side: 'p1' | 'p2', index: number, value: string) => {
		updateSlot(side, index, slot => applySpeciesDefaults({ ...slot, species: value }, catalog));
	};

	const handleFieldChange = (side: 'p1' | 'p2', index: number, field: 'item' | 'ability', value: string) => {
		updateSlot(side, index, slot => ({ ...slot, [field]: value }));
	};

	const handleMoveChange = (side: 'p1' | 'p2', slotIndex: number, moveIndex: number, value: string) => {
		updateSlot(side, slotIndex, slot => {
			const moves = [...slot.moves];
			moves[moveIndex] = value;
			return { ...slot, moves };
		});
	};

	const handleNatureChange = (side: 'p1' | 'p2', index: number, value: string) => {
		const normalized = value?.trim() || DEFAULT_NATURE;
		updateSlot(side, index, slot => ({ ...slot, nature: normalized }));
	};

	const handleGenderToggle = (side: 'p1' | 'p2', index: number) => {
		updateSlot(side, index, slot => {
			const allowed = getAvailableGenders(slot.species, catalog);
			const currentIndex = Math.max(0, allowed.indexOf(slot.gender));
			const nextGender = allowed[(currentIndex + 1) % allowed.length];
			return { ...slot, gender: nextGender };
		});
	};

	const handleLevelChange = (side: 'p1' | 'p2', index: number, value: number) => {
		updateSlot(side, index, slot => ({ ...slot, level: Math.min(100, Math.max(1, value || DEFAULT_LEVEL)) }));
	};

	const handleStatChange = (
		side: 'p1' | 'p2',
		index: number,
		type: 'evs' | 'ivs',
		stat: keyof StatsTablePayload,
		value: number,
	) => {
		updateSlot(side, index, slot => {
			const stats = { ...slot[type] };
			const max = type === 'evs' ? 252 : 31;
			stats[stat] = Math.min(max, Math.max(0, value || 0));
			return { ...slot, [type]: stats };
		});
	};

	return (
		<section className="team-editor">
			{(['p1', 'p2'] as const).map(side => (
				<div key={side} className="editor-card">
					<h3>{side === 'p1' ? 'Equipo Azul' : 'Equipo Carmesí'} – seleccionar Pokémon</h3>
					<div className="slots">
						{[0, 1, 2].map(idx => {
							const slot = selections[side][idx];
							const abilityOptions = getAbilityOptions(slot.species, catalog);
							const speciesMoveOptions = getMoveOptions(slot.species, catalog, moveOptions);
							return (
								<div key={idx} className="slot-card">
									<h4>Pokémon {idx + 1}</h4>
									<SearchableDropdown
										label="Especie"
										value={slot.species}
										options={speciesDropdownOptions}
										placeholder="Ej. Garchomp"
										onChange={value => handleSpeciesChange(side, idx, value)}
									/>
									<SearchableDropdown
										label="Objeto"
										value={slot.item}
										options={itemOptions}
										placeholder="Ej. Life Orb"
										onChange={value => handleFieldChange(side, idx, 'item', value)}
									/>
									<SearchableDropdown
										label="Habilidad"
										value={slot.ability}
										options={abilityOptions}
										placeholder="Ej. Protean"
										onChange={value => handleFieldChange(side, idx, 'ability', value)}
									/>
									<div className="moves-grid">
										{slot.moves.map((move, moveIdx) => (
											<SearchableDropdown
												key={moveIdx}
												label={`Movimiento ${moveIdx + 1}`}
												value={move}
												options={speciesMoveOptions}
												placeholder="Ej. Dragon Darts"
												onChange={value => handleMoveChange(side, idx, moveIdx, value)}
											/>
										))}
									</div>
									<details className="slot-section">
										<summary>Configuración avanzada</summary>
										<div className="meta-grid">
											<SearchableDropdown
												label="Naturaleza"
												value={slot.nature}
												options={NATURE_OPTIONS}
												placeholder="Serious"
												onChange={value => handleNatureChange(side, idx, value)}
											/>
											<div className="gender-toggle">
												<span>Género</span>
												<button type="button" onClick={() => handleGenderToggle(side, idx)}>
													{slot.gender === 'M' ? '♂' : slot.gender === 'F' ? '♀' : '–'}
												</button>
											</div>
											<label>
												<span>Nivel</span>
												<input
													type="number"
													min={1}
													max={100}
													value={slot.level}
													onChange={event => handleLevelChange(side, idx, Number(event.target.value))}
												/>
											</label>
										</div>
										<div className="stats-section">
											<div>
												<h5>EVs</h5>
												<div className="stats-grid">
													{STAT_KEYS.map(stat => (
														<label key={stat}>
															<span>{STAT_LABELS[stat]}</span>
															<input
																type="number"
																min={0}
																max={252}
																value={slot.evs[stat]}
																onChange={event =>
																	handleStatChange(side, idx, 'evs', stat, Number(event.target.value))}
															/>
														</label>
													))}
												</div>
											</div>
											<div>
												<h5>IVs</h5>
												<div className="stats-grid">
													{STAT_KEYS.map(stat => (
														<label key={stat}>
															<span>{STAT_LABELS[stat]}</span>
															<input
																type="number"
																min={0}
																max={31}
																value={slot.ivs[stat]}
																onChange={event =>
																	handleStatChange(side, idx, 'ivs', stat, Number(event.target.value))}
															/>
														</label>
													))}
												</div>
											</div>
										</div>
									</details>
								</div>
							);
						})}
					</div>
				</div>
			))}
			<div className="actions">
				<button onClick={onStartManual} disabled={manualDisabled}>
					{manualDisabled ? 'Preparando…' : 'Iniciar batalla manual'}
				</button>
			</div>
			{catalogStatus === 'loading' && <p className="helper-text">Cargando catálogo de especies…</p>}
			{catalogStatus === 'error' && (
				<div className="banner warning">
					<strong>Catálogo parcial:</strong> no se pudieron cargar todos los datos de Dex; usando listas básicas.
				</div>
			)}
		</section>
	);
}
