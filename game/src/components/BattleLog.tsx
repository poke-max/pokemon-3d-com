import { useEffect, useMemo, useRef } from 'react';

interface BattleLogProps {
	log: string[];
}

const SMART_PREFIX = '|smartai|';

export function BattleLog({ log }: BattleLogProps) {
	const previousLength = useRef(0);

	useEffect(() => {
		if (log.length < previousLength.current) {
			previousLength.current = 0;
		}
		const newEntries = log.slice(previousLength.current);
		for (const entry of newEntries) {
			if (entry.startsWith(SMART_PREFIX)) {
				const message = entry.slice(SMART_PREFIX.length).trim();
				const separatorIndex = message.indexOf(':');
				const label = separatorIndex >= 0 ? message.slice(0, separatorIndex).trim() : 'SmartAI';
				const payload = separatorIndex >= 0 ? message.slice(separatorIndex + 1).trim() : '';
				if (payload.startsWith('[') || payload.startsWith('{')) {
					try {
						const parsed = JSON.parse(payload);
						// eslint-disable-next-line no-console
						console.info(`[SmartAI] ${label}:`, parsed);
						continue;
					} catch (error) {
						console.warn('[SmartAI] No pude parsear el payload del log:', error);
					}
				}
				// eslint-disable-next-line no-console
				console.info('[SmartAI]', message);
			}
		}
		previousLength.current = log.length;
	}, [log]);

	const displayLog = useMemo(() => log.filter(entry => !entry.startsWith(SMART_PREFIX)), [log]);

	if (!displayLog.length) return null;
	return (
		<section className="log-viewer">
			<h3>Registro de la batalla</h3>
			<pre>{displayLog.join('\n')}</pre>
		</section>
	);
}
