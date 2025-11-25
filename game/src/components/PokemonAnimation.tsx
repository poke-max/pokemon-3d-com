import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { LoadedSpriteAsset, SpritePose } from '../utils/spriteLoader';
import { loadSpriteAsset } from '../utils/spriteLoader';

export interface PokemonAnimationProps {
	sprite: string | number;
	fps?: number;
	loop?: boolean;
	scale?: number;
	className?: string;
	style?: CSSProperties;
	fallbackLabel?: string;
	pose?: SpritePose;
}

const FALLBACK_SIZE = 96;

export function PokemonAnimation({
	sprite,
	fps = 12,
	loop = true,
	scale = 3,
	className,
	style,
	fallbackLabel = 'Sprite no disponible',
	pose = 'front',
}: PokemonAnimationProps) {
	const [spriteSheet, setSpriteSheet] = useState<LoadedSpriteAsset | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const normalized = `${sprite}`.trim();
		setSpriteSheet(null);
		setError(null);
		setFrameIndex(0);
		if (!normalized) {
			setError('ID de sprite vacío');
			return;
		}

		setIsLoading(true);
		void loadSpriteAsset(normalized, pose)
			.then(asset => {
				if (cancelled) return;
				setSpriteSheet(asset);
				setIsLoading(false);
			})
			.catch((loadError: any) => {
				if (cancelled) return;
				console.error('[PokemonAnimation] Falló la carga del sprite', { sprite: normalized, pose, error: loadError });
				setError(loadError?.message ?? 'No pude cargar el sprite');
				setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [sprite, pose]);

	useEffect(() => {
		if (!spriteSheet || spriteSheet.frames.length < 2) return;
		let raf: number;
		let previousTime = 0;
		let currentFrame = 0;
		let running = true;
		const duration = 1000 / Math.max(1, fps);
		const totalFrames = spriteSheet.frames.length;

		const tick = (timestamp: number) => {
			if (!running) return;
			if (timestamp - previousTime >= duration) {
				currentFrame += 1;
				if (currentFrame >= totalFrames) {
					if (!loop) {
						currentFrame = totalFrames - 1;
						setFrameIndex(currentFrame);
						running = false;
						return;
					}
					currentFrame = 0;
				}
				setFrameIndex(currentFrame);
				previousTime = timestamp;
			}
			raf = requestAnimationFrame(tick);
		};

		raf = requestAnimationFrame(tick);
		return () => {
			running = false;
			cancelAnimationFrame(raf);
		};
	}, [spriteSheet, fps, loop]);

	const containerClassName = useMemo(() => {
		return ['pokemon-animation', className].filter(Boolean).join(' ');
	}, [className]);

	const currentFrame = spriteSheet ? spriteSheet.frames[frameIndex] ?? spriteSheet.frames[0] : null;
	const offsetX = currentFrame?.spriteSourceSize?.x ?? 0;
	const offsetY = currentFrame?.spriteSourceSize?.y ?? 0;
	const displayWidth = currentFrame?.spriteSourceSize?.w ?? currentFrame?.frame?.w ?? spriteSheet?.width ?? FALLBACK_SIZE;
	const displayHeight = currentFrame?.spriteSourceSize?.h ?? currentFrame?.frame?.h ?? spriteSheet?.height ?? FALLBACK_SIZE;
	const frameStyle: CSSProperties | undefined = currentFrame && spriteSheet ? {
		width: `${currentFrame.frame.w}px`,
		height: `${currentFrame.frame.h}px`,
		backgroundImage: `url(${spriteSheet.image.src})`,
		backgroundPosition: `-${currentFrame.frame.x}px -${currentFrame.frame.y}px`,
		backgroundRepeat: 'no-repeat',
		position: 'absolute',
		left: `${offsetX}px`,
		top: `${offsetY}px`,
	} : undefined;

	const scaleFactor = Math.max(1, scale);
	const containerStyle: CSSProperties = {
		...style,
		width: `${displayWidth * scaleFactor}px`,
		height: `${displayHeight * scaleFactor}px`,
	};
	const wrapperStyle: CSSProperties = {
		width: `${displayWidth}px`,
		height: `${displayHeight}px`,
		transform: `scale(${scaleFactor})`,
		transformOrigin: 'top left',
	};

	return (
		<div className={containerClassName} style={containerStyle}>
			{spriteSheet && currentFrame && frameStyle ? (
				<div
					className="pokemon-frame-wrapper"
					style={wrapperStyle}
					aria-label={`Animación ${sprite}`}
				>
					<div className="pokemon-frame" style={frameStyle} />
				</div>
			) : (
				<span>{isLoading ? 'Cargando...' : (error ?? fallbackLabel)}</span>
			)}
		</div>
	);
}
