import { useEffect, useMemo, useState } from 'react'
import type { PokemonSlot, SceneDebugState, Vector3Like } from '../phaser/PlaygroundScene'
import './CameraControlsUI.css'

const AXES: (keyof Vector3Like)[] = ['x', 'y', 'z']

const cloneVector = (value?: Vector3Like): Vector3Like => ({
  x: Number(value?.x ?? 0),
  y: Number(value?.y ?? 0),
  z: Number(value?.z ?? 0),
})

type VectorControlProps = {
  title: string
  subtitle?: string
  values: Vector3Like
  onAxisChange: (axis: keyof Vector3Like, value: number) => void
  min?: number
  max?: number
  step?: number
}

const VectorControl = ({
  title,
  subtitle,
  values,
  onAxisChange,
  min = -6,
  max = 6,
  step = 0.1,
}: VectorControlProps) => {
  const handleAxisChange = (axis: keyof Vector3Like, rawValue: string) => {
    const numericValue = Number(rawValue)
    if (Number.isNaN(numericValue)) return
    onAxisChange(axis, numericValue)
  }

  return (
    <div className="camera-control__group">
      <div className="camera-control__group-header">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="camera-control__axis-grid">
        {AXES.map((axis) => (
          <label key={axis} className="camera-control__axis">
            <span>{axis.toUpperCase()}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={values[axis]}
              onChange={(event) => handleAxisChange(axis, event.target.value)}
            />
            <input
              type="number"
              step={step}
              value={values[axis]}
              onChange={(event) => handleAxisChange(axis, event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

type CameraControlsUIProps = {
  state?: SceneDebugState
  onUpdateCameraPosition: (next: Vector3Like) => void
  onUpdateCameraLookAt: (next: Vector3Like) => void
  onUpdateActorPosition: (slot: PokemonSlot, next: Vector3Like) => void
  onUpdateFov: (value: number) => void
  onRefresh?: () => void
}

export function CameraControlsUI({
  state,
  onUpdateCameraPosition,
  onUpdateCameraLookAt,
  onUpdateActorPosition,
  onUpdateFov,
  onRefresh,
}: CameraControlsUIProps) {
  const [cameraPosition, setCameraPosition] = useState<Vector3Like>(cloneVector())
  const [cameraLookAt, setCameraLookAt] = useState<Vector3Like>(cloneVector())
  const [cameraFov, setCameraFov] = useState(50)
  const [actorPositions, setActorPositions] = useState<Partial<Record<PokemonSlot, Vector3Like>>>({})

  useEffect(() => {
    if (!state) return
    setCameraPosition(cloneVector(state.cameraPosition))
    setCameraLookAt(cloneVector(state.cameraLookAt))
    setCameraFov(state.cameraFov)
    const nextActors: Partial<Record<PokemonSlot, Vector3Like>> = {}
    Object.entries(state.actors ?? {}).forEach(([slot, vector]) => {
      nextActors[slot as PokemonSlot] = cloneVector(vector)
    })
    setActorPositions(nextActors)
  }, [state])

  const actorEntries = useMemo(
    () => Object.entries(actorPositions) as [PokemonSlot, Vector3Like][],
    [actorPositions]
  )

  const handleCameraPositionChange = (axis: keyof Vector3Like, value: number) => {
    const next = { ...cameraPosition, [axis]: value }
    setCameraPosition(next)
    onUpdateCameraPosition(next)
  }

  const handleCameraLookAtChange = (axis: keyof Vector3Like, value: number) => {
    const next = { ...cameraLookAt, [axis]: value }
    setCameraLookAt(next)
    onUpdateCameraLookAt(next)
  }

  const handleActorPositionChange = (
    slot: PokemonSlot,
    axis: keyof Vector3Like,
    value: number
  ) => {
    setActorPositions((prev) => {
      const current = cloneVector(prev[slot])
      const next = { ...current, [axis]: value }
      onUpdateActorPosition(slot, next)
      return { ...prev, [slot]: next }
    })
  }

  const handleFovChange = (raw: string) => {
    const numeric = Number(raw)
    if (Number.isNaN(numeric)) return
    setCameraFov(numeric)
    onUpdateFov(numeric)
  }

  if (!state) {
    return (
      <section className="camera-controls animation-panel">
        <div className="camera-controls__header">
          <h2>Controles de cámara</h2>
          {onRefresh && (
            <button type="button" onClick={onRefresh}>
              Sincronizar
            </button>
          )}
        </div>
        <p className="camera-controls__empty">
          Cargando datos de la escena. Asegúrate de que la simulación esté activa.
        </p>
      </section>
    )
  }

  return (
    <section className="camera-controls animation-panel">
      <div className="camera-controls__header">
        <h2>Controles de cámara</h2>
        <button type="button" onClick={() => onRefresh?.()}>
          Sincronizar
        </button>
      </div>

      <div className="camera-controls__grid">
        <VectorControl
          title="Posición de la cámara"
          subtitle="Ajusta la ubicación del lente"
          values={cameraPosition}
          onAxisChange={handleCameraPositionChange}
          min={-8}
          max={8}
        />
        <VectorControl
          title="Mira hacia"
          subtitle="Punto de interés"
          values={cameraLookAt}
          onAxisChange={handleCameraLookAtChange}
          min={-4}
          max={4}
        />
      </div>

      <div className="camera-controls__fov">
        <div className="camera-controls__fov-header">
          <span>Campo de visión (FOV)</span>
          <strong>{cameraFov.toFixed(1)}°</strong>
        </div>
        <input
          type="range"
          min={30}
          max={110}
          step={1}
          value={cameraFov}
          onChange={(event) => handleFovChange(event.target.value)}
        />
        <div className="camera-controls__fov-range">
          <span>30°</span>
          <span>110°</span>
        </div>
      </div>

      {actorEntries.length > 0 && (
        <div className="camera-controls__grid camera-controls__grid--actors">
          {actorEntries.map(([slot, values]) => (
            <VectorControl
              key={slot}
              title={`Posición ${slot.toUpperCase()}`}
              subtitle="Arrastra para recolocar el modelo"
              values={values}
              onAxisChange={(axis, value) => handleActorPositionChange(slot, axis, value)}
              min={-6}
              max={6}
            />
          ))}
        </div>
      )}

      <div className="camera-controls__summary">
        <div>
          <span>Cam:</span>
          <code>
            {cameraPosition.x.toFixed(2)}, {cameraPosition.y.toFixed(2)}, {cameraPosition.z.toFixed(2)}
          </code>
        </div>
        <div>
          <span>LookAt:</span>
          <code>
            {cameraLookAt.x.toFixed(2)}, {cameraLookAt.y.toFixed(2)}, {cameraLookAt.z.toFixed(2)}
          </code>
        </div>
        <div>
          <span>FOV:</span>
          <code>{cameraFov.toFixed(1)}°</code>
        </div>
      </div>
    </section>
  )
}
