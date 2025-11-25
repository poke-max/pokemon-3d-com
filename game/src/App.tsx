import { useMemo, useState } from 'react';
import { ActionPanel } from './components/ActionPanel';
import { BattleLog } from './components/BattleLog';
import { BattleViewport } from './components/BattleViewport';
import { TeamBuilder } from './components/TeamBuilder';
import { BASE_TEAMS } from './data/baseTeams';
import { useDexCatalog } from './hooks/useDexCatalog';
import { useManualBattle } from './hooks/useManualBattle';
import type { DropdownOption, TeamSelections } from './types/battle';
import {
	buildTeamsPayload,
	collectBaseMoves,
	createInitialSelections,
	toOptions,
} from './utils/teamUtils';

const SPECIES_SUGGESTIONS = [
	'Annihilape', 'Arcanine-Hisui', 'Azumarill', 'Blissey', 'Charizard', 'Cinderace', 'Clodsire', 'Corviknight',
	'Dragapult', 'Enamorus', 'Flutter Mane', 'Garchomp', 'Garganacl', 'Gholdengo', 'Gliscor', 'Great Tusk',
	'Greninja', 'Heatran', 'Iron Bundle', 'Iron Hands', 'Iron Moth', 'Iron Valiant', 'Kingambit', 'Meowscarada',
	'Pelipper', 'Pikachu', 'Raging Bolt', 'Roaring Moon', 'Skeledirge', 'Ting-Lu', 'Torkoal', 'Ursaluna-Bloodmoon',
];

const ITEM_SUGGESTIONS = [
	'Booster Energy', 'Choice Band', 'Choice Specs', 'Choice Scarf', 'Heavy-Duty Boots', 'Life Orb', 'Leftovers',
	'Light Ball', 'Yache Berry', 'Focus Sash', 'Assault Vest', 'Expert Belt', 'Rocky Helmet', 'Red Card', 'Lum Berry',
	'Sitrus Berry', 'Air Balloon', 'Scope Lens',
];

const FALLBACK_SPECIES_OPTIONS = toOptions(SPECIES_SUGGESTIONS);
const FALLBACK_ITEM_OPTIONS = toOptions(ITEM_SUGGESTIONS);
const FALLBACK_MOVE_OPTIONS = toOptions(collectBaseMoves(BASE_TEAMS));

function App() {
	const { catalog, status: catalogStatus, speciesOptions } = useDexCatalog();
	const [teamSelections, setTeamSelections] = useState<TeamSelections>(createInitialSelections(BASE_TEAMS));
	const manual = useManualBattle();

	const itemOptions = useMemo<DropdownOption[]>(() => {
		if (catalog?.items?.length) return toOptions(catalog.items);
		return FALLBACK_ITEM_OPTIONS;
	}, [catalog]);

	const moveOptions = useMemo<DropdownOption[]>(() => {
		if (catalog?.moves?.length) return toOptions(catalog.moves);
		return FALLBACK_MOVE_OPTIONS;
	}, [catalog]);

	const startBattle = async () => {
		const payload = buildTeamsPayload(teamSelections, BASE_TEAMS);
		await manual.startBattle(payload);
	};

	return (
		<div className="app-shell">
			<header>
				<h1>Triple Battle UI</h1>
				<p>Controla al Jugador 1 en [Gen 9] Custom Game y deja que el rival actúe aleatoriamente.</p>
			</header>

			<div className="layout-main">
				<div className="control-panel">
					<BattleViewport state={manual.state} catalog={catalog} />
					<ActionPanel
						state={manual.state}
						sendCommand={manual.sendCommand}
						disabled={!manual.state || manual.state.ended}
					/>
					<TeamBuilder
						selections={teamSelections}
						onChange={setTeamSelections}
						catalog={catalog}
						catalogStatus={catalogStatus}
						speciesOptions={speciesOptions.length ? speciesOptions : FALLBACK_SPECIES_OPTIONS}
						itemOptions={itemOptions}
						moveOptions={moveOptions}
						onStartManual={startBattle}
						manualDisabled={catalogStatus === 'loading' || (manual.state !== null && !manual.state.ended)}
					/>


				</div>
				<BattleLog log={manual.state?.log ?? []} />
			</div>
		</div>
	);
}

export default App;
