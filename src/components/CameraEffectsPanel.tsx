type CameraEffectsPanelProps = {
  onShakeCamera?: (durationMs: number, intensity: number) => void
}

const SHAKE_PRESETS = [
  { id: 'soft', label: 'Shake suave', duration: 220, intensity: 0.08 },
  { id: 'strong', label: 'Shake fuerte', duration: 420, intensity: 0.16 },
] as const

export function CameraEffectsPanel({ onShakeCamera }: CameraEffectsPanelProps) {
  if (!onShakeCamera) return null

  return (
    <section className="animation-panel action-panel">
      <span>Efectos de camara</span>
      <div className="animation-list">
        {SHAKE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onShakeCamera(preset.duration, preset.intensity)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  )
}
