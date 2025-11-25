import { useEffect, useMemo, useRef } from 'react';
import Phaser from 'phaser';
import type { ManualBattleState } from '../types/battle';
import type { DexCatalogState } from '../hooks/useDexCatalog';
import type { SpritePose } from '../utils/spriteLoader';
import { loadSpriteAsset } from '../utils/spriteLoader';

interface BattleViewportProps {
	state: ManualBattleState | null;
	catalog: DexCatalogState | null;
}

type Slot = 'player' | 'foe';

interface SlotRenderState {
	label: string;
	hpText: string;
	hpPercent: number;
	spriteId: string | null;
	pose: SpritePose;
}

interface BattleSceneState {
	player: SlotRenderState;
	foe: SlotRenderState;
}

type MessageRecipient = Slot | 'neutral';

type BattleMessage = {
	text: string;
	slot: MessageRecipient;
};

const DEFAULT_MESSAGE_TEXT = 'Awaiting battle events...';
const DEFAULT_MESSAGE: BattleMessage = { text: DEFAULT_MESSAGE_TEXT, slot: 'neutral' };
const createNeutralMessage = (text: string): BattleMessage => ({ text, slot: 'neutral' });

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const HP_BAR_WIDTH = 180;
const HP_BAR_HEIGHT = 10;
const PLAYER_POS = { x: VIEWPORT_WIDTH * 0.28, y: VIEWPORT_HEIGHT - 20 };
const FOE_POS = { x: VIEWPORT_WIDTH * 0.72, y: VIEWPORT_HEIGHT * 0.4 };
const PLAYER_SPRITE_SCALE = 5;
const FOE_SPRITE_SCALE = 3;
const SPRITE_ANIMATION_MAX_FRAMES = 400;
const SPRITE_ANIMATION_FRAME_RATE = 10;
const MESSAGE_TEXT_PADDING = 20;
const MESSAGE_DELAY_MS = 1000;
const SMARTAI_LOG_PREFIX = '|smartai|';

interface MessageBubbleConfig {
	width: number;
	height: number;
	x: number;
	y: number;
	fillColor: number;
	fillAlpha: number;
	strokeColor: number;
	accentColor: number;
	textAlign: 'left' | 'right' | 'center';
}

const SIDE_BUBBLE_WIDTH = 360;
const SIDE_BUBBLE_HEIGHT = 110;
const MESSAGE_BUBBLE_CONFIG: Record<MessageRecipient, MessageBubbleConfig> = {
	player: {
		width: SIDE_BUBBLE_WIDTH,
		height: SIDE_BUBBLE_HEIGHT,
		x: PLAYER_POS.x - 140,
		y: PLAYER_POS.y - 240,
		fillColor: 0x06291c,
		fillAlpha: 0.92,
		strokeColor: 0x22c55e,
		accentColor: 0x16a34a,
		textAlign: 'left',
	},
	foe: {
		width: SIDE_BUBBLE_WIDTH,
		height: SIDE_BUBBLE_HEIGHT,
		x: FOE_POS.x + 140,
		y: FOE_POS.y - 200,
		fillColor: 0x2d0f1b,
		fillAlpha: 0.92,
		strokeColor: 0xf97316,
		accentColor: 0xfb923c,
		textAlign: 'right',
	},
	neutral: {
		width: VIEWPORT_WIDTH - 80,
		height: 110,
		x: VIEWPORT_WIDTH / 2,
		y: VIEWPORT_HEIGHT - 110 / 2 - 16,
		fillColor: 0x020617,
		fillAlpha: 0.92,
		strokeColor: 0x38bdf8,
		accentColor: 0x0ea5e9,
		textAlign: 'center',
	},
};

interface MessageBubble {
	container: Phaser.GameObjects.Container;
	text: Phaser.GameObjects.Text;
}

const parseHP = (condition: string | undefined) => {
	if (!condition) return { text: '???', percent: 0 };
	if (condition.includes('/')) {
		const [value, max] = condition.split('/').map(part => parseInt(part, 10));
		if (!Number.isNaN(value) && !Number.isNaN(max) && max > 0) {
			return { text: `${value}/${max}`, percent: Math.max(0, Math.min(100, Math.round((value / max) * 100))) };
		}
	}
	if (condition.endsWith('%')) {
		const value = parseInt(condition, 10);
		if (!Number.isNaN(value)) return { text: `${value}%`, percent: Math.max(0, Math.min(100, value)) };
	}
	return { text: condition, percent: 0 };
};

const pickActive = (pokemonList: any[] | undefined) => {
	if (!pokemonList?.length) return null;
	return pokemonList.find(p => p.active) ?? pokemonList[0];
};

const parseSpeciesFromDetails = (details: string | undefined) => {
	if (!details) return null;
	const [name] = details.split(',');
	return name?.trim() || null;
};

const parseSpeciesFromIdent = (ident: string | undefined) => {
	if (!ident) return null;
	const colonIndex = ident.indexOf(':');
	if (colonIndex === -1) return ident.trim();
	return ident.slice(colonIndex + 1).trim() || null;
};

const resolveSpriteId = (details: string | undefined, fallbackIdent: string | undefined, catalog: DexCatalogState | null) => {
	const speciesName = parseSpeciesFromDetails(details) ?? parseSpeciesFromIdent(fallbackIdent);
	if (!speciesName || !catalog) return null;
	const entry = catalog.speciesMap[speciesName.toLowerCase()];
	if (!entry) return null;
	return entry.spriteId || String(entry.num);
};

const TRAINER_LABELS: Record<string, string> = {
	p1: 'Player 1',
	p2: 'CPU',
};

const extractSideKey = (ident?: string | null) => {
	if (!ident) return null;
	const match = ident.match(/^(p\d)/i);
	return match ? match[1].toLowerCase() : null;
};

const getTrainerLabel = (ident?: string | null) => {
	const key = extractSideKey(ident);
	if (key && TRAINER_LABELS[key as keyof typeof TRAINER_LABELS]) {
		return TRAINER_LABELS[key as keyof typeof TRAINER_LABELS];
	}
	if (ident && TRAINER_LABELS[ident as keyof typeof TRAINER_LABELS]) {
		return TRAINER_LABELS[ident as keyof typeof TRAINER_LABELS];
	}
	return ident ?? 'Trainer';
};

const getPokemonName = (ident?: string) => parseSpeciesFromIdent(ident) ?? 'A Pokémon';

const getSpeciesLabel = (details?: string, fallbackIdent?: string) =>
	parseSpeciesFromDetails(details) ?? parseSpeciesFromIdent(fallbackIdent) ?? 'a Pokémon';

const getMessageSlotFromIdent = (ident?: string | null): Slot | null => {
	const key = extractSideKey(ident);
	if (!key) return null;
	if (key === 'p1') return 'player';
	if (key === 'p2') return 'foe';
	return null;
};

const formatHpValue = (value?: string) => {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.includes('/')) return `${trimmed} HP`;
	if (trimmed.endsWith('%')) return `${trimmed} HP`;
	return trimmed;
};

const STATUS_LABELS: Record<string, string> = {
	brn: 'burned',
	par: 'paralyzed',
	slp: 'asleep',
	frz: 'frozen',
	psn: 'poisoned',
	tox: 'badly poisoned',
};

const describeStatus = (code?: string) => {
	if (!code) return 'afflicted';
	return STATUS_LABELS[code.toLowerCase()] ?? code;
};

const STAT_LABELS: Record<string, string> = {
	atk: 'Attack',
	def: 'Defense',
	spa: 'Sp. Atk',
	spd: 'Sp. Def',
	spe: 'Speed',
	accuracy: 'Accuracy',
	evasion: 'Evasion',
};

const formatStatName = (code?: string) => {
	if (!code) return 'a stat';
	const normalized = code.toLowerCase() as keyof typeof STAT_LABELS;
	return STAT_LABELS[normalized] ?? code.toUpperCase();
};

const describeActivationSource = (payload?: string) => {
	if (!payload) return 'an effect';
	const sanitized = payload.replace(/^\[(from|of)\]\s*/i, '').trim();
	const colonIndex = sanitized.indexOf(':');
	if (colonIndex === -1) return sanitized;
	const label = sanitized.slice(0, colonIndex).trim().toLowerCase();
	const value = sanitized.slice(colonIndex + 1).trim();
	if (!value) {
		switch (label) {
		case 'move':
			return 'a move';
		case 'item':
			return 'an item';
		case 'ability':
			return 'an ability';
		default:
			return sanitized;
		}
	}
	switch (label) {
	case 'move':
		return `the move ${value}`;
	case 'ability':
		return `the ${value} ability`;
	case 'item':
		return value;
	case 'weather':
		return `${value} weather`;
	default:
		return value;
	}
};

const EFFECT_LABEL_OVERRIDES: Record<string, string> = {
	quackdrivespe: 'Quark Drive',
	quackdriveatk: 'Quark Drive',
	quackdrivedef: 'Quark Drive',
	quackdrivespa: 'Quark Drive',
	quackdrivespd: 'Quark Drive',
	quarkdrivespe: 'Quark Drive',
	quarkdriveatk: 'Quark Drive',
	quarkdrivedef: 'Quark Drive',
	quarkdrivespa: 'Quark Drive',
	quarkdrivespd: 'Quark Drive',
};

const formatEffectLabel = (effect?: string) => {
	if (!effect) return null;
	const trimmed = effect.trim();
	if (!trimmed) return null;
	const normalized = trimmed.toLowerCase();
	if (EFFECT_LABEL_OVERRIDES[normalized]) {
		return EFFECT_LABEL_OVERRIDES[normalized];
	}
	return trimmed
		.replace(/[-_]/g, ' ')
		.replace(/\b\w/g, char => char.toUpperCase());
};

const buildFallbackMessage = (command: string, args: string[]) => {
	const payload = args.filter(Boolean).join(' | ');
	if (!payload) return null;
	return { text: `${command.toUpperCase()}: ${payload}`, slot: 'neutral' };
};

const buildMessage = (text: string | null | undefined, slot?: Slot | null): BattleMessage | null => {
	if (!text) return null;
	return { text, slot: slot ?? 'neutral' };
};

const formatBattleLogEntry = (entry: string): BattleMessage | null => {
	if (!entry) return null;
	if (!entry.startsWith('|')) return buildMessage(entry.trim(), null);
	const parts = entry.split('|');
	parts.shift();
	if (!parts.length) return null;
	const command = parts.shift()?.trim();
	if (!command) return null;
	const args = parts.map(part => part.trim());
	const slotFromSide = (side?: string | null) => getMessageSlotFromIdent(side);
	const slotFromIdent = (ident?: string | null) => getMessageSlotFromIdent(ident);

	switch (command) {
	case 'start':
		return DEFAULT_MESSAGE;
	case 'turn':
		return null;
	case 'player':
		return buildMessage(`${getTrainerLabel(args[0] ?? undefined)} will be known as ${args[1] || 'Unknown'}.`, slotFromSide(args[0]));
	case 'teamsize':
		return null;
	case 'poke':
		return null;
	case 'clearpoke':
		return null;
	case 'teampreview':
		return buildMessage('Team Preview begins.', null);
	case 'tier':
		return null;
	case 'gen':
		return null;
	case 'gametype':
		return null;
	case 'switch': {
		const hp = formatHpValue(args[2]);
		return buildMessage(
			`${getTrainerLabel(args[0])} sent out ${getSpeciesLabel(args[1], args[0])}!${hp ? ` (${hp})` : ''}`,
			slotFromIdent(args[0]),
		);
	}
	case 'drag': {
		const hp = formatHpValue(args[2]);
		return buildMessage(
			`${getSpeciesLabel(args[1], args[0])} was dragged out!${hp ? ` (${hp})` : ''}`,
			slotFromIdent(args[0]),
		);
	}
	case 'move':
		return buildMessage(`${getPokemonName(args[0])} used ${args[1] || 'a move'}!`, slotFromIdent(args[0]));
	case 'faint':
		return buildMessage(`${getPokemonName(args[0])} fainted!`, slotFromIdent(args[0]));
	case 'win': {
		const winner = args[0];
		if (!winner) return buildMessage('A side has won the battle!', null);
		if (winner.startsWith('p')) {
			return buildMessage(`${getTrainerLabel(winner)} won the battle!`, slotFromSide(winner));
		}
		return buildMessage(`${winner} won the battle!`, null);
	}
	case 'tie':
		return buildMessage('The battle ended in a tie!', null);
	case 'upkeep':
		return buildMessage('End-of-turn effects resolve.', null);
	case '-damage': {
		const hp = formatHpValue(args[1]);
		const from = args.find(arg => arg.startsWith('[from]'));
		const cause = from ? describeActivationSource(from) : null;
		let text = `${getPokemonName(args[0])} took damage!`;
		if (hp) text += ` ${hp} remaining.`;
		if (cause) text += ` (${cause})`;
		return buildMessage(text, slotFromIdent(args[0]));
	}
	case '-heal': {
		const hp = formatHpValue(args[1]);
		const from = args.find(arg => arg.startsWith('[from]'));
		const cause = from ? describeActivationSource(from) : null;
		let text = `${getPokemonName(args[0])} restored health!`;
		if (hp) text += ` ${hp} now.`;
		if (cause) text += ` (${cause})`;
		return buildMessage(text, slotFromIdent(args[0]));
	}
	case '-status':
		return buildMessage(`${getPokemonName(args[0])} is now ${describeStatus(args[1])}!`, slotFromIdent(args[0]));
	case '-curestatus':
		return buildMessage(`${getPokemonName(args[0])} is no longer ${describeStatus(args[1])}.`, slotFromIdent(args[0]));
	case '-boost': {
		const amount = Number.parseInt(args[2] || '1', 10) || 1;
		const stage = amount === 1 ? 'stage' : 'stages';
		return buildMessage(
			`${getPokemonName(args[0])}'s ${formatStatName(args[1])} rose by ${amount} ${stage}!`,
			slotFromIdent(args[0]),
		);
	}
	case '-unboost': {
		const amount = Number.parseInt(args[2] || '1', 10) || 1;
		const stage = amount === 1 ? 'stage' : 'stages';
		return buildMessage(
			`${getPokemonName(args[0])}'s ${formatStatName(args[1])} fell by ${amount} ${stage}.`,
			slotFromIdent(args[0]),
		);
	}
	case '-singleturn':
		return buildMessage(
			`${getPokemonName(args[0])} is protected by ${args[1] || 'an effect'}!`,
			slotFromIdent(args[0]),
		);
	case '-activate':
		return buildMessage(
			`${getPokemonName(args[0])} activated ${describeActivationSource(args[1])}!`,
			slotFromIdent(args[0]),
		);
	case '-enditem':
		return buildMessage(
			`${getPokemonName(args[0])}'s ${args[1] || 'item'} was consumed.`,
			slotFromIdent(args[0]),
		);
	case '-fail':
		return buildMessage(
			`${getPokemonName(args[0])}'s ${args[1] || 'action'} failed.`,
			slotFromIdent(args[0]),
		);
	case '-start': {
		const effect = args[1];
		const source = args.find(arg => arg.startsWith('[from]'));
		const cause = source ? describeActivationSource(source) : null;
		if (effect === 'typechange') {
			const newType = args[2];
			const baseText = newType
				? `${getPokemonName(args[0])} changed into the ${newType} type!`
				: `${getPokemonName(args[0])} changed types!`;
			const text = cause ? `${baseText} (${cause})` : baseText;
			return buildMessage(text, slotFromIdent(args[0]));
		}
		if (effect) {
			const readableEffect = formatEffectLabel(effect) ?? effect;
			const text = cause
				? `${getPokemonName(args[0])} is affected by ${readableEffect}. (${cause})`
				: `${getPokemonName(args[0])} is affected by ${readableEffect}.`;
			return buildMessage(text, slotFromIdent(args[0]));
		}
		return buildMessage(`${getPokemonName(args[0])} activated an effect!`, slotFromIdent(args[0]));
	}
	case '-supereffective':
		return buildMessage(`It's super effective!`, slotFromIdent(args[0]));
	case '-weather':
		return buildMessage(
			args[0] === 'none' ? 'The weather has cleared.' : `The weather is now ${args[0]}.`,
			null,
		);
	case 'raw':
	case 'message':
		return buildMessage(args[0] || null, null);
	case 'debug':
	case 't:':
	case 'inactive':
	case 'inactiveoff':
	case 'request':
		return null;
	default:
		return buildFallbackMessage(command, args);
	}
};

type HpBarElements = {
	label: Phaser.GameObjects.Text;
	hpText: Phaser.GameObjects.Text;
	track: Phaser.GameObjects.Rectangle;
	fill: Phaser.GameObjects.Rectangle;
};

type SpriteResources = {
	sprite: Phaser.GameObjects.Sprite;
	animKey: string;
	atlasKey: string;
};

class BattleScene extends Phaser.Scene {
	private pendingState: BattleSceneState | null = null;
	private ui: Record<Slot, HpBarElements> | null = null;
	private spriteResources: Partial<Record<Slot, SpriteResources>> = {};
	private spriteLoadToken: Record<Slot, number> = { player: 0, foe: 0 };
	private messageBubbles: Partial<Record<MessageRecipient, MessageBubble>> = {};
	private messageQueue: BattleMessage[] = [];
	private messageTimer: Phaser.Time.TimerEvent | null = null;
	private pendingMessage: BattleMessage | null = DEFAULT_MESSAGE;
	private shouldStartQueueOnCreate = false;
	private readyCallbacks: Array<() => void> = [];
	private isReady = false;

	constructor() {
		super({ key: 'BattleScene' });
	}

	public setBattleState(state: BattleSceneState) {
		this.pendingState = state;
		if (this.scene?.isActive()) this.applyState(state);
	}

	create() {
		this.ui = {
			player: this.createSlotUI('player', VIEWPORT_WIDTH - 40, VIEWPORT_HEIGHT - 100, true),
			foe: this.createSlotUI('foe', 40, 30, false),
		};
		this.createMessageBubbles();
		if (this.pendingMessage) {
			const initialMessage = this.pendingMessage;
			this.pendingMessage = null;
			this.displayMessage(initialMessage);
		} else {
			this.displayMessage(DEFAULT_MESSAGE);
		}
		if (this.shouldStartQueueOnCreate && this.messageQueue.length) {
			this.startMessageLoop();
		}
		this.shouldStartQueueOnCreate = false;
		this.isReady = true;
		if (this.readyCallbacks.length) {
			for (const callback of this.readyCallbacks) {
				try {
					callback();
				} catch (error) {
					console.error('[BattleScene] Ready callback failed:', error);
				}
			}
			this.readyCallbacks = [];
		}
		if (this.pendingState) this.applyState(this.pendingState);
	}

	private createSlotUI(slot: Slot, labelX: number, labelY: number, alignRight: boolean): HpBarElements {
		const label = this.add.text(labelX, labelY, slot === 'player' ? 'P1' : 'CPU', {
			fontFamily: 'Poppins, sans-serif',
			fontSize: '18px',
			color: '#e2e8f0',
			fontStyle: '600',
		}).setOrigin(alignRight ? 1 : 0, 0.5);
		const hpText = this.add.text(labelX, labelY + 24, '???', {
			fontFamily: 'JetBrains Mono, monospace',
			fontSize: '14px',
			color: '#94a3b8',
		}).setOrigin(alignRight ? 1 : 0, 0.5);
		const track = this.add.rectangle(labelX, labelY + 46, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x1e293b)
			.setOrigin(alignRight ? 1 : 0, 0.5)
			.setAlpha(0.9);
		const fill = this.add.rectangle(labelX, labelY + 46, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x22c55e)
			.setOrigin(alignRight ? 1 : 0, 0.5)
			.setAlpha(0.95);
		return { label, hpText, track, fill };
	}

	private applyState(state: BattleSceneState) {
		this.updateSlot('player', state.player);
		this.updateSlot('foe', state.foe);
	}

	private updateSlot(slot: Slot, data: SlotRenderState) {
		if (!this.ui) return;
		const ui = this.ui[slot];
		ui.label.setText(data.label);
		ui.hpText.setText(data.hpText);
		const percent = Math.max(0, Math.min(100, data.hpPercent));
		const width = (HP_BAR_WIDTH * percent) / 100;
		ui.fill.displayWidth = Math.max(4, width);
		ui.fill.fillColor = percent > 50 ? 0x22c55e : percent > 20 ? 0xfbbf24 : 0xef4444;
		this.loadSpriteForSlot(slot, data);
	}

	private async loadSpriteForSlot(slot: Slot, data: SlotRenderState) {
		this.spriteLoadToken[slot] += 1;
		const token = this.spriteLoadToken[slot];
		if (!data.spriteId) {
			this.clearSprite(slot);
			return;
		}
		try {
			const asset = await loadSpriteAsset(data.spriteId, data.pose);
			if (token !== this.spriteLoadToken[slot]) return;
			this.renderSprite(slot, asset);
		} catch (error) {
			console.error('[BattleScene] No pude renderizar sprite', slot, data.spriteId, error);
			this.clearSprite(slot);
		}
	}

	private renderSprite(slot: Slot, asset: Awaited<ReturnType<typeof loadSpriteAsset>>) {
		this.clearSprite(slot);
		const atlasKey = `${slot}-${asset.spriteId}-atlas-${asset.pose}-${Date.now()}`;
		if (this.textures.exists(atlasKey)) this.textures.remove(atlasKey);
		this.textures.addAtlasJSONArray(atlasKey, asset.image, asset.atlas);

		const originalWarn = console.warn;
		let generatedFrames: Phaser.Types.Animations.AnimationFrame[];
		try {
			console.warn = () => {};
			generatedFrames = this.anims.generateFrameNames(atlasKey, {
				start: 1,
				end: SPRITE_ANIMATION_MAX_FRAMES,
				zeroPad: 4,
				suffix: '.png',
			});
		} finally {
			console.warn = originalWarn;
		}
		const fallbackFrames: Phaser.Types.Animations.AnimationFrame[] = asset.frames.map(frame => ({
			key: atlasKey,
			frame: frame.filename,
			duration: frame.duration ?? 100,
		}));
		const animationFrames = generatedFrames.length ? generatedFrames : fallbackFrames;
		if (!animationFrames.length) return;

		const animKey = `${slot}-${asset.spriteId}-anim-${asset.pose}-${Date.now()}`;
		this.anims.create({
			key: animKey,
			frames: animationFrames,
			frameRate: SPRITE_ANIMATION_FRAME_RATE,
			repeat: -1,
		});

		const position = slot === 'player' ? PLAYER_POS : FOE_POS;
		const spriteScaleX = slot === 'player' ? PLAYER_SPRITE_SCALE : -FOE_SPRITE_SCALE;
		const spriteScaleY = slot === 'player' ? PLAYER_SPRITE_SCALE : FOE_SPRITE_SCALE;
		const sprite = this.add.sprite(position.x, position.y, atlasKey, animationFrames[0]?.frame)
			.setOrigin(0.5, 1)
			.setScale(spriteScaleX, spriteScaleY)
			.setFlipX(slot === 'foe')
			.setDepth(slot === 'player' ? 2 : 3);
		sprite.play(animKey);
		this.spriteResources[slot] = { sprite, animKey, atlasKey };
	}

	private clearSprite(slot: Slot) {
		const resources = this.spriteResources[slot];
		if (!resources) return;
		resources.sprite.destroy();
		if (this.anims.exists(resources.animKey)) this.anims.remove(resources.animKey);
		if (this.textures.exists(resources.atlasKey)) this.textures.remove(resources.atlasKey);
		delete this.spriteResources[slot];
	}

	shutdown() {
		this.clearSprite('player');
		this.clearSprite('foe');
		Object.values(this.messageBubbles).forEach(bubble => bubble.container.destroy(true));
		this.messageBubbles = {};
		this.messageQueue = [];
		if (this.messageTimer) {
			this.messageTimer.remove(false);
			this.messageTimer = null;
		}
		this.readyCallbacks = [];
		this.isReady = false;
	}

	public enqueueMessages(messages: BattleMessage[]) {
		if (!messages.length) return;
		this.messageQueue.push(...messages);
		if (!Object.keys(this.messageBubbles).length) {
			this.shouldStartQueueOnCreate = true;
			return;
		}
		if (!this.messageTimer) this.startMessageLoop();
	}

	public resetMessageQueue(message?: BattleMessage) {
		this.messageQueue = [];
		this.shouldStartQueueOnCreate = false;
		if (this.messageTimer) {
			this.messageTimer.remove(false);
			this.messageTimer = null;
		}
		const nextMessage = message ?? DEFAULT_MESSAGE;
		if (!Object.keys(this.messageBubbles).length) {
			this.pendingMessage = nextMessage;
			return;
		}
		this.displayMessage(nextMessage);
	}

	private createMessageBubbles() {
		this.messageBubbles = {};
		(Object.entries(MESSAGE_BUBBLE_CONFIG) as Array<[MessageRecipient, MessageBubbleConfig]>).forEach(
			([recipient, config], index) => {
				const container = this.add.container(config.x, config.y)
					.setDepth(recipient === 'neutral' ? 7 : 8 + index)
					.setAlpha(0);
				const background = this.add.rectangle(0, 0, config.width, config.height, config.fillColor, config.fillAlpha)
					.setOrigin(0.5)
					.setStrokeStyle(2, config.strokeColor, 0.8);
				const accent = this.add.rectangle(
					0,
					-config.height / 2 + 6,
					config.width - 24,
					4,
					config.accentColor,
					0.95,
				).setOrigin(0.5, 0);
				const text = this.add.text(
					-config.width / 2 + MESSAGE_TEXT_PADDING,
					-config.height / 2 + MESSAGE_TEXT_PADDING,
					'',
					{
						fontFamily: 'Poppins, sans-serif',
						fontSize: '20px',
						color: '#f8fafc',
						wordWrap: { width: config.width - MESSAGE_TEXT_PADDING * 2 },
						align: config.textAlign,
						lineSpacing: 6,
					},
				);
				if (config.textAlign === 'right') {
					text.setOrigin(1, 0);
					text.setX(config.width / 2 - MESSAGE_TEXT_PADDING);
				} else if (config.textAlign === 'center') {
					text.setOrigin(0.5, 0);
					text.setX(0);
				} else {
					text.setOrigin(0, 0);
				}
				container.add([background, accent, text]);
				this.messageBubbles[recipient as MessageRecipient] = { container, text };
			},
		);
	}

	private startMessageLoop() {
		if (this.messageTimer || !this.messageQueue.length) return;
		if (!Object.keys(this.messageBubbles).length) {
			this.shouldStartQueueOnCreate = true;
			return;
		}
		const next = this.messageQueue.shift();
		if (!next) return;
		this.displayMessage(next);
		this.messageTimer = this.time.delayedCall(MESSAGE_DELAY_MS, () => {
			this.messageTimer = null;
			this.startMessageLoop();
		});
	}

	private displayMessage(message: BattleMessage) {
		if (!Object.keys(this.messageBubbles).length) {
			this.pendingMessage = message;
			return;
		}
		const recipient = this.messageBubbles[message.slot] ? message.slot : 'neutral';
		const target = this.messageBubbles[recipient];
		if (!target) return;
		target.text.setText(message.text);
		(Object.entries(this.messageBubbles) as Array<[MessageRecipient, MessageBubble]>).forEach(([key, bubble]) => {
			const isTarget = key === recipient;
			this.tweens.add({
				targets: bubble.container,
				alpha: isTarget ? 1 : 0,
				duration: 180,
				ease: 'Sine.easeOut',
			});
		});
	}

	public onReady(callback: () => void) {
		if (this.isReady) {
			callback();
			return;
		}
		this.readyCallbacks.push(callback);
	}
}

export function BattleViewport({ state, catalog }: BattleViewportProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const gameRef = useRef<Phaser.Game | null>(null);
	const sceneRef = useRef<BattleScene | null>(null);
	const latestStateRef = useRef<BattleSceneState | null>(null);
	const pendingMessagesRef = useRef<BattleMessage[]>([]);
	const pendingResetMessageRef = useRef<BattleMessage | null>(DEFAULT_MESSAGE);
	const logTrackerRef = useRef<{ battleId: string | null; length: number }>({ battleId: null, length: 0 });

	const queueMessagesForScene = (messages: BattleMessage[]) => {
		if (!messages.length) return;
		const scene = sceneRef.current;
		if (scene) {
			scene.enqueueMessages(messages);
			return;
		}
		pendingMessagesRef.current.push(...messages);
	};

	const requestMessageReset = (message: BattleMessage) => {
		pendingMessagesRef.current = [];
		const scene = sceneRef.current;
		if (scene) {
			scene.resetMessageQueue(message);
			pendingResetMessageRef.current = null;
		} else {
			pendingResetMessageRef.current = message;
		}
	};

	const flushPendingMessages = () => {
		const scene = sceneRef.current;
		if (!scene) return;
		if (pendingResetMessageRef.current !== null) {
			scene.resetMessageQueue(pendingResetMessageRef.current);
			pendingResetMessageRef.current = null;
		}
		if (pendingMessagesRef.current.length) {
			scene.enqueueMessages(pendingMessagesRef.current);
			pendingMessagesRef.current = [];
		}
	};

	const renderState = useMemo<BattleSceneState>(() => {
		const request = state?.request;
		const playerSlot = request?.active ? pickActive(request.side?.pokemon) : null;
		const foeSlot = pickActive(request?.foe?.pokemon);
		const playerDisplayed = playerSlot || state?.player || null;
		const foeDisplayed = foeSlot || state?.foe || null;
		const playerSpriteId = resolveSpriteId(playerSlot?.details, playerDisplayed?.ident, catalog);
		const foeSpriteId = resolveSpriteId(foeSlot?.details, foeDisplayed?.ident, catalog);
		const playerLabel = playerDisplayed?.ident ?? 'P1 (?)';
		const foeLabel = foeDisplayed?.ident ?? 'CPU (?)';
		const playerHP = playerDisplayed ? parseHP(playerDisplayed.condition) : { text: '???', percent: 0 };
		const foeHP = foeDisplayed ? parseHP(foeDisplayed.condition) : { text: '???', percent: 0 };
		return {
			player: {
				label: playerLabel,
				hpText: playerHP.text,
				hpPercent: playerHP.percent,
				spriteId: playerSpriteId,
				pose: 'back',
			},
			foe: {
				label: foeLabel,
				hpText: foeHP.text,
				hpPercent: foeHP.percent,
				spriteId: foeSpriteId,
				pose: 'front',
			},
		};
	}, [state, catalog]);

	useEffect(() => {
		if (!containerRef.current) return;
		const scene = new BattleScene();
		sceneRef.current = scene;

		const game = new Phaser.Game({
			type: Phaser.AUTO,
			width: VIEWPORT_WIDTH,
			height: VIEWPORT_HEIGHT,
			parent: containerRef.current,
			transparent: true,
			backgroundColor: '#000000',
			scene,
			render: {
				antialias: false,
				roundPixels: true,
				pixelArt: true,
			},
		});
		gameRef.current = game;
		scene.onReady(() => {
			flushPendingMessages();
		});
		if (latestStateRef.current) scene.setBattleState(latestStateRef.current);
		return () => {
			sceneRef.current = null;
			game.destroy(true);
			gameRef.current = null;
		};
	}, []);

	useEffect(() => {
		latestStateRef.current = renderState;
		sceneRef.current?.setBattleState(renderState);
	}, [renderState]);

	useEffect(() => {
		const currentLog = state?.log ?? [];
		const currentId = state?.id ?? null;
		const tracker = logTrackerRef.current;
		if (tracker.battleId !== currentId) {
			tracker.battleId = currentId;
			tracker.length = 0;
			const resetMessage = currentId
				? createNeutralMessage('A new battle is about to begin!')
				: DEFAULT_MESSAGE;
			requestMessageReset(resetMessage);
		} else if (currentLog.length < tracker.length) {
			tracker.length = 0;
		}

		if (!currentLog.length) return;
		let startIndex = tracker.length;
		if (startIndex >= currentLog.length) return;

		if (tracker.length === 0) {
			const firstSwitch =
				currentLog.findIndex(line => line.startsWith('|switch|') || line.startsWith('|drag|'));
			if (firstSwitch > 0) {
				startIndex = firstSwitch;
				tracker.length = firstSwitch;
			}
		}

		const formatted: BattleMessage[] = [];
		const newEntries = currentLog.slice(startIndex);
		let suppressUpkeep = false;

		for (const entry of newEntries) {
			if (!entry || entry.startsWith(SMARTAI_LOG_PREFIX)) continue;
			if (entry === '|upkeep') {
				suppressUpkeep = true;
				continue;
			}

			const isActionEntry = entry.startsWith('|move|') || entry.startsWith('|switch|') || entry.startsWith('|drag|');
			if (isActionEntry) {
				suppressUpkeep = false;
			}

			if (suppressUpkeep) {
				if (entry.startsWith('|-enditem|')) continue;
				if (entry.startsWith('|debug|') && entry.includes('-50% reduction')) continue;
			}

			const message = formatBattleLogEntry(entry);
			if (message) formatted.push(message);
		}
		if (formatted.length) {
			queueMessagesForScene(formatted);
		}
		tracker.length = currentLog.length;
	}, [state?.log, state?.id]);

	return (
		<section className="battle-viewport">
			<div className="phaser-battle-container" ref={containerRef} />
		</section>
	);
}
