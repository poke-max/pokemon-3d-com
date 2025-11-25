import type { ManualBattleState } from '../types/battle';

interface ActionPanelProps {
	state: ManualBattleState | null;
	sendCommand: (command: string) => Promise<void>;
	disabled?: boolean;
}

export function ActionPanel({ state, sendCommand, disabled }: ActionPanelProps) {
	if (!state) return null;
	const request = state.request;

	if (state.ended) {
		return (
			<section className="action-panel">
				<h3>Acciones</h3>
				<p>Combate finalizado. Ganador: {state.winner ?? 'Empate'}</p>
			</section>
		);
	}

	if (!request) {
		return (
			<section className="action-panel">
				<h3>Acciones</h3>
				<p>Esperando la siguiente solicitud…</p>
			</section>
		);
	}

	if (request.teamPreview) {
		const order = (request.side?.pokemon ?? []).map((_: any, idx: number) => idx + 1).join('');
		return (
			<section className="action-panel">
				<h3>Acciones</h3>
				<p>Confirmá el orden inicial (usamos el vigente por defecto).</p>
				<button
					disabled={disabled}
					onClick={() => {
						console.info('[ManualBattle] Confirmando orden inicial', order);
						void sendCommand(`team ${order}`).catch(error => {
							console.error('[ManualBattle] Falló al confirmar el orden', error);
						});
					}}
				>
					Confirmar orden ({order.split('').join(', ')})
				</button>
			</section>
		);
	}

	if (request.wait) {
		return (
			<section className="action-panel">
				<h3>Acciones</h3>
				<p>Esperando al rival…</p>
			</section>
		);
	}

	const active = request.active?.[0];
	const canMove = !request.forceSwitch?.[0];
	const moves = active?.moves ?? [];
	const sidePokemon = request.side?.pokemon ?? [];
	const bench: Array<{ poke: any; index: number }> = sidePokemon
		.map((poke: any, index: number) => ({ poke, index }))
		.filter(({ poke }: { poke: any }) => !poke.active && !poke.condition?.includes(' fnt'));

	return (
		<section className="action-panel">
			<h3>Acciones</h3>
			<div className="actions">
				{moves.map((move: any, idx: number) => (
					<button
						key={move.id ?? idx}
						disabled={disabled || move.disabled || !canMove}
						onClick={() => void sendCommand(`move ${idx + 1}`)}
					>
						{move.move}
					</button>
				))}
			</div>
			{bench.length ? (
				<div className="switches">
					<p>Cambiar a:</p>
					{bench.map(({ poke, index }: { poke: any; index: number }) => (
						<button
							key={poke.ident}
							disabled={disabled}
							onClick={() => void sendCommand(`switch ${index + 1}`)}
						>
							{poke.ident}
						</button>
					))}
				</div>
			) : null}
		</section>
	);
}
