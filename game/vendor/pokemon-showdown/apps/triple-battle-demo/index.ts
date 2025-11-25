import '../../../sim/global-types';
import { DEFAULT_TEAMS, TripleBattleComponent } from './TripleBattleComponent';

async function main() {
	const component = new TripleBattleComponent();
	const result = await component.simulate(DEFAULT_TEAMS);

	console.log(`Formato: ${result.view.format}`);
	for (const slot of ['p1', 'p2'] as const) {
		const side = result.view.sides[slot];
		console.log(`\n${side.name}`);
		for (const mon of side.pokemon) {
			console.log(
				`  ${mon.slot}. ${mon.nickname} (${mon.species}) [${mon.types.join('/')}] @ ${mon.item ?? '—'}`
			);
			console.log(`     Habilidad: ${mon.ability} | Movimientos: ${mon.moves.join(', ')}`);
		}
	}

	console.log('\n=== Registro completo ===');
	console.log(result.log.join('\n'));
}

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
