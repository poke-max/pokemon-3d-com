import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManualBattleState, TripleBattleTeamsPayload } from '../types/battle';

interface ManualStartResponse {
	id: string;
	state: ManualBattleState;
}

export function useManualBattle() {
	const [state, setState] = useState<ManualBattleState | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const pollingRef = useRef<number | null>(null);

	const stopPolling = () => {
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
	};

	const fetchState = useCallback(async (id: string) => {
		const response = await fetch(`/api/manual/state?id=${encodeURIComponent(id)}`);
		if (!response.ok) throw new Error('No se pudo obtener el estado');
		const data = await response.json() as ManualBattleState;
		setState(data);
		if (data.ended) stopPolling();
	}, []);

	const startBattle = useCallback(async (teams: TripleBattleTeamsPayload) => {
		stopPolling();
		setState(null);
		setSessionId(null);
		const response = await fetch('/api/manual/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ teams }),
		});
		if (!response.ok) throw new Error('No se pudo iniciar la batalla');
		const payload = await response.json() as ManualStartResponse;
		setSessionId(payload.id);
		setState(payload.state);
		pollingRef.current = window.setInterval(() => {
			void fetchState(payload.id).catch(() => stopPolling());
		}, 1200);
	}, [fetchState]);

	const sendCommand = useCallback(async (command: string) => {
		if (!sessionId) return;
		const response = await fetch('/api/manual/command', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: sessionId, command }),
		});
		if (!response.ok) throw new Error('No se pudo enviar el comando');
		await fetchState(sessionId);
	}, [sessionId, fetchState]);

	useEffect(() => () => stopPolling(), []);

	return {
		state,
		sessionId,
		startBattle,
		sendCommand,
	};
}
