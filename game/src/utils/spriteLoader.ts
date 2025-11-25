import type Phaser from 'phaser';

export type SpritePose = 'front' | 'back';

export type SpriteFrame = {
	filename: string;
	rotated: boolean;
	trimmed: boolean;
	sourceSize: { w: number; h: number };
	spriteSourceSize: { x: number; y: number; w: number; h: number };
	frame: { x: number; y: number; w: number; h: number };
	duration?: number;
};

type TextureAtlas = {
	image: string;
	size: { w: number; h: number };
	scale: number;
	frames: SpriteFrame[];
};

type TexturePackerPayload = {
	textures: TextureAtlas[];
};

type AsepritePayload = {
	frames: SpriteFrame[];
	meta?: {
		size?: { w: number; h: number };
	};
};

type SpritePayload = TexturePackerPayload | AsepritePayload;

type NormalizedSpritePayload = {
	frames: SpriteFrame[];
	width: number;
	height: number;
	atlas: Phaser.Types.Textures.TextureAtlasJSON;
};

const DEFAULT_SIZE = 96;

const FRONT_DIR = '../assets/images/pokemon';
const BACK_DIR = '../assets/images/pokemon/back';

const FRONT_SHEETS = import.meta.glob('../assets/images/pokemon/*.png', { as: 'url' }) as Record<string, () => Promise<string>>;
const FRONT_DATA = import.meta.glob('../assets/images/pokemon/*.json', { import: 'default' }) as Record<string, () => Promise<SpritePayload>>;
const BACK_SHEETS = import.meta.glob('../assets/images/pokemon/back/*.png', { as: 'url' }) as Record<string, () => Promise<string>>;
const BACK_DATA = import.meta.glob('../assets/images/pokemon/back/*.json', { import: 'default' }) as Record<string, () => Promise<SpritePayload>>;

type SpriteSourceGroup = {
	dir: string;
	sheets: Record<string, () => Promise<string>>;
	data: Record<string, () => Promise<SpritePayload>>;
};

const SPRITE_SOURCES: Record<SpritePose, SpriteSourceGroup> = {
	front: { dir: FRONT_DIR, sheets: FRONT_SHEETS, data: FRONT_DATA },
	back: { dir: BACK_DIR, sheets: BACK_SHEETS, data: BACK_DATA },
};

const computeLogicalSize = (frames: SpriteFrame[], fallback?: { w?: number; h?: number }) => {
	const initialWidth = fallback?.w ?? 0;
	const initialHeight = fallback?.h ?? 0;
	return frames.reduce<{ w: number; h: number }>((acc, frame) => {
		const width = frame.sourceSize?.w ?? frame.frame?.w ?? 0;
		const height = frame.sourceSize?.h ?? frame.frame?.h ?? 0;
		return {
			w: Math.max(acc.w, width),
			h: Math.max(acc.h, height),
		};
	}, { w: initialWidth, h: initialHeight });
};

const normalizeSpritePayload = (payload: SpritePayload): NormalizedSpritePayload => {
	if (payload && 'textures' in payload && Array.isArray(payload.textures) && payload.textures.length) {
		const atlas = payload.textures[0];
		const size = computeLogicalSize(atlas.frames, atlas.size);
		return {
			frames: atlas.frames,
			width: size.w || DEFAULT_SIZE,
			height: size.h || DEFAULT_SIZE,
			atlas: {
				frames: atlas.frames,
				meta: {
					image: atlas.image,
					size: atlas.size,
					scale: String(atlas.scale ?? 1),
				},
			},
		};
	}
	if (payload && 'frames' in payload && Array.isArray(payload.frames) && payload.frames.length) {
		const size = computeLogicalSize(payload.frames, payload.meta?.size);
		return {
			frames: payload.frames,
			width: size.w || DEFAULT_SIZE,
			height: size.h || DEFAULT_SIZE,
			atlas: {
				frames: payload.frames,
				meta: {
					image: '',
					size,
					scale: '1',
				},
			},
		};
	}
	throw new Error('Atlas vacío');
};

const loadImageElement = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
	const image = new Image();
	image.src = src;
	image.onload = () => resolve(image);
	image.onerror = reject;
});

export interface LoadedSpriteAsset {
	spriteId: string;
	pose: SpritePose;
	frames: SpriteFrame[];
	width: number;
	height: number;
	image: HTMLImageElement;
	atlas: Phaser.Types.Textures.TextureAtlasJSON;
}

const getSourceGroup = (spriteId: string, pose: SpritePose) => {
	const normalized = spriteId.trim();
	const primary = SPRITE_SOURCES[pose];
	const primarySheet = primary.sheets[`${primary.dir}/${normalized}.png`];
	const primaryData = primary.data[`${primary.dir}/${normalized}.json`];
	if (primarySheet && primaryData) {
		return { group: primary, sheet: primarySheet, data: primaryData };
	}
	if (pose === 'front') return null;
	const fallback = SPRITE_SOURCES.front;
	const fallbackSheet = fallback.sheets[`${fallback.dir}/${normalized}.png`];
	const fallbackData = fallback.data[`${fallback.dir}/${normalized}.json`];
	if (fallbackSheet && fallbackData) {
		return { group: fallback, sheet: fallbackSheet, data: fallbackData };
	}
	return null;
};

export async function loadSpriteAsset(sprite: string | number, pose: SpritePose): Promise<LoadedSpriteAsset> {
	const spriteId = `${sprite}`.trim();
	const sources = getSourceGroup(spriteId, pose);
	if (!sources) throw new Error(`No encontré assets para ${spriteId}`);
	const [imageUrl, payload] = await Promise.all([sources.sheet(), sources.data()]);
	const parsed = normalizeSpritePayload(payload);
	const image = await loadImageElement(imageUrl);
	if (!parsed.atlas.meta) parsed.atlas.meta = { image: '', size: { w: parsed.width, h: parsed.height }, scale: '1' };
	parsed.atlas.meta.image = image.src;
	return {
		spriteId,
		pose,
		frames: parsed.frames,
		width: parsed.width,
		height: parsed.height,
		image,
		atlas: parsed.atlas,
	};
}
