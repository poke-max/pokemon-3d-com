import { THREE } from '@enable3d/phaser-extension'
import type Phaser from 'phaser'
import type { PokemonSlot } from './PlaygroundScene'

type WeatherBounds = { minY: number; maxY: number; halfWidth: number; halfDepth: number }

type RainEffectState = {
  object: THREE.InstancedMesh
  material: THREE.MeshBasicMaterial
  headPositions: Float32Array
  directions: Float32Array
  speeds: Float32Array
  lengths: Float32Array
  animationFrame?: number
  bounds: WeatherBounds
  intensity: number
  baseOpacity: number
  fadeTween?: Phaser.Tweens.Tween
}

type SnowWeatherEffectState = {
  object: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  texture: THREE.Texture
  speeds: Float32Array
  wiggleOffsets: Float32Array
  wiggleMagnitudes: Float32Array
  bounds: WeatherBounds
  animationFrame?: number
  intensity: number
  baseOpacity: number
  baseSize: number
  fadeTween?: Phaser.Tweens.Tween
}

type SunnyWeatherEffectState = {
  group: THREE.Group
  sprite: THREE.Sprite
  spriteMaterial: THREE.SpriteMaterial
  spriteTexture: THREE.Texture
  rayMaterials: THREE.MeshBasicMaterial[]
  rayGeometry: THREE.BufferGeometry
  light: THREE.DirectionalLight
  animationFrame?: number
  intensity: number
  baseLightIntensity: number
  fadeTween?: Phaser.Tweens.Tween
}

type WindWeatherEffectState = {
  type: 'sandstorm' | 'deltastream'
  object: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  texture: THREE.Texture
  positions: Float32Array
  swirlAngles: Float32Array
  swirlSpeeds: Float32Array
  baseVelocities: Float32Array
  bounds: WeatherBounds
  animationFrame?: number
  intensity: number
  baseOpacity: number
  fadeTween?: Phaser.Tweens.Tween
}

type PokemonActorLike = {
  object: THREE.Object3D
  height: number
}

type PokemonFxContext = {
  getActor(slot: PokemonSlot): PokemonActorLike | undefined
  getScene(): THREE.Scene
  time: Phaser.Time.Clock
  tweens: Phaser.Tweens.TweenManager
}

export class PokemonFxManager {
  private readonly context: PokemonFxContext
  private rainEffect?: RainEffectState
  private snowEffect?: SnowWeatherEffectState
  private sunnyEffect?: SunnyWeatherEffectState
  private sandstormEffect?: WindWeatherEffectState
  private deltaStreamEffect?: WindWeatherEffectState

  constructor(context: PokemonFxContext) {
    this.context = context
  }

  private hasActiveWeatherEffect() {
    return Boolean(
      this.rainEffect ||
        this.snowEffect ||
        this.sunnyEffect ||
        this.sandstormEffect ||
        this.deltaStreamEffect
    )
  }

  playSwapParticles(slot: PokemonSlot, implode: boolean = false) {
    const actor = this.context.getActor(slot)
    if (!actor) return

    const scene = this.context.getScene()
    const position = actor.object.position.clone()
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.85, 'rgba(255, 255, 255, 0.5)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const particleCount = 300
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const sizes = new Float32Array(particleCount)
    const opacities = new Float32Array(particleCount)
    const velocities: THREE.Vector3[] = []

    const centerY = position.y + actor.object.scale.y * actor.height * 0.5
    const implodeRadius = 0.3
    const explodeRadius = 0.1
    const maxDistance = implode ? implodeRadius : explodeRadius

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const speed = Math.random() * 2.5 + 1.5

      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed,
        Math.sin(phi) * Math.sin(theta) * speed
      )
      velocities.push(velocity)

      if (implode) {
        positions[i * 3] = position.x + velocity.x * maxDistance
        positions[i * 3 + 1] = centerY + velocity.y * maxDistance
        positions[i * 3 + 2] = position.z + velocity.z * maxDistance
      } else {
        positions[i * 3] = position.x
        positions[i * 3 + 1] = centerY
        positions[i * 3 + 2] = position.z
      }

      const colorChoice = Math.random()
      if (colorChoice < 0.33) {
        colors[i * 3] = 1.0
        colors[i * 3 + 1] = 1.0
        colors[i * 3 + 2] = 1.0
      } else if (colorChoice < 0.66) {
        colors[i * 3] = 1.0
        colors[i * 3 + 1] = 1.0
        colors[i * 3 + 2] = 0.3
      } else {
        colors[i * 3] = 0.3
        colors[i * 3 + 1] = 0.8
        colors[i * 3 + 2] = 1.0
      }

      sizes[i] = Math.random() * 0.1 + 0.05
      opacities[i] = 1.0
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: texture },
        globalOpacity: { value: 1.0 },
      },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          vColor = color;
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        uniform float globalOpacity;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          vec4 texColor = texture2D(pointTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, texColor.a * vOpacity * globalOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const duration = 1400
    const startTime = Date.now()

    const animateParticles = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      const positionAttribute = geometry.getAttribute('position')
      const opacityAttribute = geometry.getAttribute('opacity') as THREE.BufferAttribute

      for (let i = 0; i < particleCount; i++) {
        const velocity = velocities[i]
        const easeOut = 1 - Math.pow(1 - progress, 2)

        if (implode) {
          const startX = positions[i * 3]
          const startY = positions[i * 3 + 1]
          const startZ = positions[i * 3 + 2]

          positionAttribute.setXYZ(
            i,
            THREE.MathUtils.lerp(startX, position.x, easeOut),
            THREE.MathUtils.lerp(startY, centerY, easeOut),
            THREE.MathUtils.lerp(startZ, position.z, easeOut)
          )

          let particleOpacity = 0
          if (progress <= 0.3) {
            particleOpacity = progress / 0.3
          }

          opacityAttribute.setX(i, particleOpacity)
        } else {
          const distance = easeOut * maxDistance
          positionAttribute.setXYZ(
            i,
            positions[i * 3] + velocity.x * distance,
            positions[i * 3 + 1] + velocity.y * distance,
            positions[i * 3 + 2] + velocity.z * distance
          )

          let particleOpacity = 1.0
          if (progress > 0.1) {
            particleOpacity = 1.0 - (progress - 0.1) / 0.3
          }
          opacityAttribute.setX(i, particleOpacity)
        }
      }

      positionAttribute.needsUpdate = true
      opacityAttribute.needsUpdate = true

      if (progress < 1) {
        requestAnimationFrame(animateParticles)
      } else {
        scene.remove(particles)
        geometry.dispose()
        material.dispose()
        texture.dispose()
      }
    }

    animateParticles()
  }

  playHealingParticles(slot: PokemonSlot) {
    const actor = this.context.getActor(slot)
    if (!actor) return

    const scene = this.context.getScene()
    const basePosition = actor.object.position.clone()
    const centerY = basePosition.y + actor.object.scale.y * actor.height * 0.5

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(180, 255, 200, 1)')
    gradient.addColorStop(0.6, 'rgba(120, 255, 190, 0.8)')
    gradient.addColorStop(1, 'rgba(80, 190, 150, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const particleCount = 240
    const positions = new Float32Array(particleCount * 3)
    const velocities: THREE.Vector3[] = []

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = basePosition.x
      positions[i * 3 + 1] = centerY
      positions[i * 3 + 2] = basePosition.z

      const angle = Math.random() * Math.PI * 2
      const radialSpeed = 0.65 + Math.random() * 0.7
      const upward = 1.4 + Math.random() * 0.8
      velocities.push(
        new THREE.Vector3(
          Math.cos(angle) * radialSpeed,
          upward,
          Math.sin(angle) * radialSpeed
        )
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      size: 0.28,
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const duration = 900
    const gravity = -3
    let startTime = performance.now()
    let previous = startTime

    const animate = (timestamp: number) => {
      const deltaSeconds = (timestamp - previous) / 1000
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
        const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
        const array = positionAttr.array as Float32Array
        for (let i = 0; i < particleCount; i++) {
          const velocity = velocities[i]
          velocity.y += gravity * deltaSeconds
          const idx = i * 3
          array[idx] += velocity.x * deltaSeconds
          array[idx + 1] += velocity.y * deltaSeconds
          array[idx + 2] += velocity.z * deltaSeconds
        }
        positionAttr.needsUpdate = true
      }

      previous = timestamp
      const elapsed = timestamp - startTime
      const progress = Math.min(elapsed / duration, 1)
      material.opacity = 1 - progress

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        scene.remove(particles)
        geometry.dispose()
        material.dispose()
        texture.dispose()
      }
    }

    requestAnimationFrame(animate)
  }

  playStatChangeParticles(slot: PokemonSlot, type: 'buff' | 'debuff'): Promise<void> {
    const actor = this.context.getActor(slot)
    if (!actor) return Promise.resolve()

    const scene = this.context.getScene()
    const basePosition = actor.object.position.clone()
    const scaledHeight = actor.height * actor.object.scale.y
    const startY =
      type === 'buff'
        ? basePosition.y + scaledHeight * 0.4
        : basePosition.y + scaledHeight * 0.95

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.resolve()

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    if (type === 'buff') {
      gradient.addColorStop(0, 'rgba(255, 120, 120, 1)')
      gradient.addColorStop(0.7, 'rgba(255, 80, 80, 0.9)')
      gradient.addColorStop(1, 'rgba(255, 80, 80, 0)')
    } else {
      gradient.addColorStop(0, 'rgba(100, 185, 255, 1)')
      gradient.addColorStop(0.7, 'rgba(80, 140, 255, 0.9)')
      gradient.addColorStop(1, 'rgba(80, 140, 255, 0)')
    }

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const particleCount = 140
    const positions = new Float32Array(particleCount * 3)
    const velocities: THREE.Vector3[] = []

    for (let i = 0; i < particleCount; i++) {
      const horizontalRadius = 0.35
      const xOffset = (Math.random() - 0.5) * horizontalRadius
      const zOffset = (Math.random() - 0.5) * horizontalRadius
      positions[i * 3] = basePosition.x + xOffset
      positions[i * 3 + 1] = startY + (Math.random() - 0.5) * 0.05
      positions[i * 3 + 2] = basePosition.z + zOffset

      const angle = Math.random() * Math.PI * 2
      const horizontalSpeed = 0.4 + Math.random() * 0.6
      const yVelocity =
        type === 'buff'
          ? 0.9 + Math.random() * 1.1
          : -(0.7 + Math.random() * 0.9)

      velocities.push(
        new THREE.Vector3(
          Math.cos(angle) * horizontalSpeed,
          yVelocity,
          Math.sin(angle) * horizontalSpeed
        )
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      size: 0.22,
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const duration = 1100
    let startTime = performance.now()
    let previous = startTime

    return new Promise<void>((resolve) => {
      const animate = (timestamp: number) => {
        const deltaSeconds = (timestamp - previous) / 1000
        if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
          const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
          const array = positionAttr.array as Float32Array
          for (let i = 0; i < particleCount; i++) {
            const velocity = velocities[i]
            velocity.y += (type === 'buff' ? 0.25 : -0.25) * deltaSeconds
            const idx = i * 3
            array[idx] += velocity.x * deltaSeconds
            array[idx + 1] += velocity.y * deltaSeconds
            array[idx + 2] += velocity.z * deltaSeconds
          }
          positionAttr.needsUpdate = true
        }

        previous = timestamp
        const elapsed = timestamp - startTime
        const progress = Math.min(elapsed / duration, 1)
        material.opacity = 0.95 * (1 - progress)

        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          scene.remove(particles)
          geometry.dispose()
          material.dispose()
          texture.dispose()
          resolve()
        }
      }

      requestAnimationFrame(animate)
    })
  }

  startRainWeather() {
    if (this.hasActiveWeatherEffect()) return false
    const scene = this.context.getScene()
    const particleCount = 900
    const bounds = {
      minY: 0,
      maxY: 8.5,
      halfWidth: 5.5,
      halfDepth: 4.5,
    }
    const headPositions = new Float32Array(particleCount * 3)
    const directions = new Float32Array(particleCount * 3)
    const speeds = new Float32Array(particleCount)
    const lengths = new Float32Array(particleCount)

    const randomizeDrop = (index: number) => {
      const headIdx = index * 3
      headPositions[headIdx] = (Math.random() * 2 - 1) * bounds.halfWidth
      headPositions[headIdx + 1] = bounds.maxY + Math.random() * 3
      headPositions[headIdx + 2] = (Math.random() * 2 - 1) * bounds.halfDepth
      const driftX = -0.35 + (Math.random() - 0.5) * 0.4
      const driftZ = 0.25 + (Math.random() - 0.5) * 0.4
      const dir = new THREE.Vector3(driftX, -1, driftZ).normalize()
      directions[headIdx] = dir.x
      directions[headIdx + 1] = dir.y
      directions[headIdx + 2] = dir.z
      speeds[index] = 8 + Math.random() * 6
      lengths[index] = 1 + Math.random() * 1.8
    }

    for (let i = 0; i < particleCount; i++) {
      randomizeDrop(i)
    }

    const dropGeometry = new THREE.PlaneGeometry(0.05, 1)
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9cd7ff),
      transparent: true,
      opacity: 0.30,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const rainMesh = new THREE.InstancedMesh(dropGeometry, material, particleCount)
    rainMesh.frustumCulled = false
    scene.add(rainMesh)
    const dummy = new THREE.Object3D()
    const upVector = new THREE.Vector3(0, 1, 0)
    const dirVector = new THREE.Vector3()

    const updatePositions = (deltaSeconds: number) => {
      const effect = this.rainEffect
      const intensity = THREE.MathUtils.clamp(effect?.intensity ?? 1, 0, 1)
      const speedFactor = intensity
      const lengthFactor = THREE.MathUtils.lerp(0.2, 1, intensity)
      const thicknessFactor = THREE.MathUtils.lerp(0.15, 1, intensity)
      for (let i = 0; i < particleCount; i++) {
        const headIdx = i * 3
        const dirX = directions[headIdx]
        const dirY = directions[headIdx + 1]
        const dirZ = directions[headIdx + 2]
        headPositions[headIdx] += dirX * speeds[i] * deltaSeconds * speedFactor
        headPositions[headIdx + 1] += dirY * speeds[i] * deltaSeconds * speedFactor
        headPositions[headIdx + 2] += dirZ * speeds[i] * deltaSeconds * speedFactor

        if (headPositions[headIdx + 1] < bounds.minY) {
          randomizeDrop(i)
        } else {
          if (headPositions[headIdx] > bounds.halfWidth) {
            headPositions[headIdx] = -bounds.halfWidth
          } else if (headPositions[headIdx] < -bounds.halfWidth) {
            headPositions[headIdx] = bounds.halfWidth
          }
          if (headPositions[headIdx + 2] > bounds.halfDepth) {
            headPositions[headIdx + 2] = -bounds.halfDepth
          } else if (headPositions[headIdx + 2] < -bounds.halfDepth) {
            headPositions[headIdx + 2] = bounds.halfDepth
          }
        }

        dirVector.set(dirX, dirY, dirZ)
        const length = Math.max(0.02, lengths[i] * lengthFactor)
        dummy.position.set(
          headPositions[headIdx] - dirX * length * 0.5,
          headPositions[headIdx + 1] - dirY * length * 0.5,
          headPositions[headIdx + 2] - dirZ * length * 0.5
        )
        const baseThickness = Math.max(0.01, 0.15 * thicknessFactor)
        dummy.scale.set(baseThickness, length, baseThickness)
        dummy.quaternion.setFromUnitVectors(upVector, dirVector)
        dummy.updateMatrix()
        rainMesh.setMatrixAt(i, dummy.matrix)
      }
      rainMesh.instanceMatrix.needsUpdate = true
    }

    let previous = performance.now()
    const animate = (timestamp: number) => {
      const effect = this.rainEffect
      if (!effect) return
      const deltaSeconds = Math.min(0.05, Math.max(0.016, (timestamp - previous) / 1000 || 0))
      previous = timestamp
      updatePositions(deltaSeconds)
      effect.animationFrame = requestAnimationFrame(animate)
    }

    this.rainEffect = {
      object: rainMesh,
      material,
      headPositions,
      directions,
      speeds,
      lengths,
      bounds,
      intensity: 1,
      baseOpacity: material.opacity,
    }
    updatePositions(0)
    this.rainEffect.animationFrame = requestAnimationFrame(animate)
    return true
  }

  stopRainWeather() {
    const effect = this.rainEffect
    if (!effect || effect.fadeTween) return false

    effect.fadeTween = this.context.tweens.addCounter({
      from: effect.intensity,
      to: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const currentEffect = this.rainEffect
        if (!currentEffect) return
        const value = Math.max(0, Number(tween.getValue()))
        currentEffect.intensity = value
        currentEffect.material.opacity = currentEffect.baseOpacity * value
        currentEffect.material.needsUpdate = true
      },
      onComplete: () => {
        this.disposeRainEffect(effect)
      },
    })
    return true
  }

  private disposeRainEffect(effect: RainEffectState) {
    if (effect.animationFrame !== undefined) {
      cancelAnimationFrame(effect.animationFrame)
    }
    if (effect.fadeTween) {
      effect.fadeTween.stop()
      this.context.tweens.remove(effect.fadeTween)
      effect.fadeTween = undefined
    }
    const scene = this.context.getScene()
    scene.remove(effect.object)
    effect.object.geometry.dispose()
    effect.material.dispose()
    if (this.rainEffect === effect) {
      this.rainEffect = undefined
    }
  }

  startSnowscapeWeather() {
    if (this.hasActiveWeatherEffect()) return false
    const scene = this.context.getScene()
    const flakeCount = 900
    const bounds: WeatherBounds = {
      minY: 0,
      maxY: 8,
      halfWidth: 5.2,
      halfDepth: 4.2,
    }
    const positions = new Float32Array(flakeCount * 3)
    const speeds = new Float32Array(flakeCount)
    const wiggleOffsets = new Float32Array(flakeCount)
    const wiggleMagnitudes = new Float32Array(flakeCount)
    const randomizeFlake = (index: number) => {
      const idx = index * 3
      positions[idx] = (Math.random() * 2 - 1) * bounds.halfWidth
      positions[idx + 1] = bounds.maxY + Math.random() * 3
      positions[idx + 2] = (Math.random() * 2 - 1) * bounds.halfDepth
      speeds[index] = 1.5 + Math.random() * 1.5
      wiggleOffsets[index] = Math.random() * Math.PI * 2
      wiggleMagnitudes[index] = 0.6 + Math.random() * 0.6
    }
    for (let i = 0; i < flakeCount; i++) {
      randomizeFlake(i)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const texture = this.createCircularTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)')
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(0xe9f6ff),
      size: 0.32,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: texture,
      alphaTest: 0.01,
      sizeAttenuation: true,
    })
    const object = new THREE.Points(geometry, material)
    object.frustumCulled = false
    scene.add(object)

    const effect: SnowWeatherEffectState = {
      object,
      geometry,
      material,
      texture,
      speeds,
      wiggleOffsets,
      wiggleMagnitudes,
      bounds,
      intensity: 1,
      baseOpacity: material.opacity,
      baseSize: material.size,
    }
    this.snowEffect = effect

    const updateFlakes = (deltaSeconds: number, wiggleTime: number) => {
      for (let i = 0; i < flakeCount; i++) {
        const idx = i * 3
        positions[idx + 1] -= speeds[i] * deltaSeconds * (0.45 + effect.intensity * 0.8)
        const wiggle = wiggleMagnitudes[i] * (0.4 + effect.intensity * 0.6)
        positions[idx] += Math.sin(wiggleTime + wiggleOffsets[i]) * wiggle * deltaSeconds
        positions[idx + 2] += Math.cos(wiggleTime * 0.8 + wiggleOffsets[i]) * wiggle * 0.6 * deltaSeconds
        if (positions[idx + 1] < bounds.minY) {
          randomizeFlake(i)
        }
      }
      geometry.attributes.position.needsUpdate = true
    }

    let previous = performance.now()
    const animate = (timestamp: number) => {
      const current = this.snowEffect
      if (!current) return
      const deltaSeconds = Math.min(0.05, Math.max(0.016, (timestamp - previous) / 1000 || 0))
      previous = timestamp
      const wiggleTime = timestamp * 0.0012
      current.material.size = current.baseSize * THREE.MathUtils.lerp(0.4, 1, current.intensity)
      updateFlakes(deltaSeconds, wiggleTime)
      current.animationFrame = requestAnimationFrame(animate)
    }
    updateFlakes(0, performance.now() * 0.0012)
    this.snowEffect.animationFrame = requestAnimationFrame(animate)
    return true
  }

  stopSnowscapeWeather() {
    const effect = this.snowEffect
    if (!effect || effect.fadeTween) return false
    effect.fadeTween = this.context.tweens.addCounter({
      from: effect.intensity,
      to: 0,
      duration: 1400,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const current = this.snowEffect
        if (!current) return
        const value = Math.max(0, Number(tween.getValue()))
        current.intensity = value
        current.material.opacity = current.baseOpacity * value
        current.material.size = current.baseSize * THREE.MathUtils.lerp(0.25, 1, value)
        current.material.needsUpdate = true
      },
      onComplete: () => {
        this.disposeSnowEffect(effect)
      },
    })
    return true
  }

  private disposeSnowEffect(effect: SnowWeatherEffectState) {
    if (effect.animationFrame !== undefined) {
      cancelAnimationFrame(effect.animationFrame)
    }
    if (effect.fadeTween) {
      effect.fadeTween.stop()
      this.context.tweens.remove(effect.fadeTween)
      effect.fadeTween = undefined
    }
    const scene = this.context.getScene()
    scene.remove(effect.object)
    effect.geometry.dispose()
    effect.material.dispose()
    effect.texture.dispose()
    if (this.snowEffect === effect) {
      this.snowEffect = undefined
    }
  }

  startSunnyDayWeather() {
    if (this.hasActiveWeatherEffect()) return false
    const scene = this.context.getScene()
    const group = new THREE.Group()
    const light = new THREE.DirectionalLight(0xfff3c0, 2.5)
    light.position.set(-3.5, 7.2, 2.2)
    light.target.position.set(0, 0, 0)
    group.add(light)
    group.add(light.target)

    const sunTexture = this.createCircularTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)')
    const spriteMaterial = new THREE.SpriteMaterial({
      map: sunTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(spriteMaterial)
    sprite.position.copy(light.position)
    sprite.scale.set(8.5, 8.5, 8.5)
    group.add(sprite)

    const rayGeometry = new THREE.PlaneGeometry(0.55, 5.8)
    const rayMaterials: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < 6; i++) {
      const rayMaterial = new THREE.MeshBasicMaterial({
        color: 0xffedb0,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const ray = new THREE.Mesh(rayGeometry, rayMaterial)
      ray.position.copy(light.position)
      ray.rotation.z = (Math.PI / 3) * i
      ray.rotation.x = -0.5
      group.add(ray)
      rayMaterials.push(rayMaterial)
    }

    scene.add(group)
    const effect: SunnyWeatherEffectState = {
      group,
      sprite,
      spriteMaterial,
      spriteTexture: sunTexture,
      rayMaterials,
      rayGeometry,
      light,
      intensity: 1,
      baseLightIntensity: light.intensity,
    }
    this.sunnyEffect = effect

    let previous = performance.now()
    const animate = (timestamp: number) => {
      const current = this.sunnyEffect
      if (!current) return
      const deltaSeconds = Math.min(0.05, Math.max(0.016, (timestamp - previous) / 1000 || 0))
      previous = timestamp
      const pulse =
        0.9 + 0.1 * Math.sin(timestamp * 0.0016) * THREE.MathUtils.clamp(current.intensity, 0, 1)
      const scale = 8 * pulse
      current.group.rotation.y += 0.12 * deltaSeconds
      current.sprite.scale.set(scale, scale, scale)
      current.spriteMaterial.opacity = 0.9 * current.intensity
      const lightPulse = 0.85 + 0.15 * Math.sin(timestamp * 0.0012)
      current.light.intensity = current.baseLightIntensity * lightPulse * current.intensity
      current.rayMaterials.forEach((material, index) => {
        material.opacity = 0.35 * current.intensity * (0.8 + 0.2 * Math.sin(timestamp * 0.002 + index))
      })
      current.animationFrame = requestAnimationFrame(animate)
    }
    this.sunnyEffect.animationFrame = requestAnimationFrame(animate)
    return true
  }

  stopSunnyDayWeather() {
    const effect = this.sunnyEffect
    if (!effect || effect.fadeTween) return false
    effect.fadeTween = this.context.tweens.addCounter({
      from: effect.intensity,
      to: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const current = this.sunnyEffect
        if (!current) return
        const value = Math.max(0, Number(tween.getValue()))
        current.intensity = value
        current.spriteMaterial.opacity = 0.9 * value
        current.rayMaterials.forEach((material) => {
          material.opacity = 0.35 * value
        })
        current.light.intensity = current.baseLightIntensity * value
      },
      onComplete: () => {
        this.disposeSunnyWeather(effect)
      },
    })
    return true
  }

  private disposeSunnyWeather(effect: SunnyWeatherEffectState) {
    if (effect.animationFrame !== undefined) {
      cancelAnimationFrame(effect.animationFrame)
    }
    if (effect.fadeTween) {
      effect.fadeTween.stop()
      this.context.tweens.remove(effect.fadeTween)
      effect.fadeTween = undefined
    }
    const scene = this.context.getScene()
    scene.remove(effect.group)
    effect.spriteMaterial.dispose()
    effect.spriteTexture.dispose()
    effect.rayMaterials.forEach((material) => material.dispose())
    effect.rayGeometry.dispose()
    if (this.sunnyEffect === effect) {
      this.sunnyEffect = undefined
    }
  }

  startSandstormWeather() {
    return this.startWindWeather('sandstorm', 0xb89455)
  }

  stopSandstormWeather() {
    return this.stopWindWeather('sandstorm')
  }

  startDeltaStreamWeather() {
    return this.startWindWeather('deltastream', 0x9fa9bd)
  }

  stopDeltaStreamWeather() {
    return this.stopWindWeather('deltastream')
  }

  private startWindWeather(type: 'sandstorm' | 'deltastream', color: number) {
    if (this.hasActiveWeatherEffect()) return false
    const scene = this.context.getScene()
    const particleCount = 1200
    const bounds: WeatherBounds = {
      minY: 0,
      maxY: 6,
      halfWidth: 6,
      halfDepth: 5,
    }
    const positions = new Float32Array(particleCount * 3)
    const swirlAngles = new Float32Array(particleCount)
    const swirlSpeeds = new Float32Array(particleCount)
    const baseVelocities = new Float32Array(particleCount)
    const randomizeParticle = (index: number) => {
      const idx = index * 3
      positions[idx] = -bounds.halfWidth + Math.random() * bounds.halfWidth * 2
      positions[idx + 1] = bounds.minY + Math.random() * (bounds.maxY - bounds.minY)
      positions[idx + 2] = (Math.random() * 2 - 1) * bounds.halfDepth
      swirlAngles[index] = Math.random() * Math.PI * 2
      swirlSpeeds[index] = 0.6 + Math.random() * 1.2
      baseVelocities[index] = 0.8 + Math.random() * 1.2
    }
    for (let i = 0; i < particleCount; i++) {
      randomizeParticle(i)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const texture = this.createCircularTexture('rgba(255,255,255,0.4)', 'rgba(255,255,255,0)')
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.45,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: texture,
      alphaTest: 0.05,
      sizeAttenuation: true,
    })
    const object = new THREE.Points(geometry, material)
    object.frustumCulled = false
    scene.add(object)
    const effect: WindWeatherEffectState = {
      type,
      object,
      geometry,
      material,
      texture,
      positions,
      swirlAngles,
      swirlSpeeds,
      baseVelocities,
      bounds,
      intensity: 1,
      baseOpacity: material.opacity,
    }
    if (type === 'sandstorm') {
      this.sandstormEffect = effect
    } else {
      this.deltaStreamEffect = effect
    }
    let previous = performance.now()
    const animate = (timestamp: number) => {
      const current = type === 'sandstorm' ? this.sandstormEffect : this.deltaStreamEffect
      if (!current) return
      const deltaSeconds = Math.min(0.05, Math.max(0.016, (timestamp - previous) / 1000 || 0))
      previous = timestamp
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3
        swirlAngles[i] += swirlSpeeds[i] * deltaSeconds * (0.6 + current.intensity * 0.6)
        const drift = baseVelocities[i] * deltaSeconds * (0.8 + current.intensity * 0.6)
        positions[idx] += drift * 0.6 + Math.cos(swirlAngles[i]) * 0.8 * deltaSeconds * current.intensity
        positions[idx + 1] += Math.sin(swirlAngles[i] * 0.5) * 0.35 * deltaSeconds * current.intensity
        positions[idx + 2] += Math.sin(swirlAngles[i]) * 0.9 * deltaSeconds * current.intensity
        if (
          positions[idx] > bounds.halfWidth ||
          positions[idx] < -bounds.halfWidth ||
          positions[idx + 1] > bounds.maxY ||
          positions[idx + 1] < bounds.minY ||
          positions[idx + 2] > bounds.halfDepth ||
          positions[idx + 2] < -bounds.halfDepth
        ) {
          randomizeParticle(i)
        }
      }
      geometry.attributes.position.needsUpdate = true
      current.material.opacity = current.baseOpacity * current.intensity
      current.animationFrame = requestAnimationFrame(animate)
    }
    const holder = type === 'sandstorm' ? this.sandstormEffect : this.deltaStreamEffect
    if (holder) {
      holder.animationFrame = requestAnimationFrame(animate)
    }
    return true
  }

  private stopWindWeather(type: 'sandstorm' | 'deltastream') {
    const effect = type === 'sandstorm' ? this.sandstormEffect : this.deltaStreamEffect
    if (!effect || effect.fadeTween) return false
    effect.fadeTween = this.context.tweens.addCounter({
      from: effect.intensity,
      to: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const current = type === 'sandstorm' ? this.sandstormEffect : this.deltaStreamEffect
        if (!current) return
        const value = Math.max(0, Number(tween.getValue()))
        current.intensity = value
        current.material.opacity = current.baseOpacity * value
      },
      onComplete: () => {
        this.disposeWindWeather(effect)
      },
    })
    return true
  }

  private disposeWindWeather(effect: WindWeatherEffectState) {
    if (effect.animationFrame !== undefined) {
      cancelAnimationFrame(effect.animationFrame)
    }
    if (effect.fadeTween) {
      effect.fadeTween.stop()
      this.context.tweens.remove(effect.fadeTween)
      effect.fadeTween = undefined
    }
    const scene = this.context.getScene()
    scene.remove(effect.object)
    effect.geometry.dispose()
    effect.material.dispose()
    effect.texture.dispose()
    if (effect.type === 'sandstorm' && this.sandstormEffect === effect) {
      this.sandstormEffect = undefined
    } else if (effect.type === 'deltastream' && this.deltaStreamEffect === effect) {
      this.deltaStreamEffect = undefined
    }
  }

  private createCircularTexture(innerColor: string, outerColor: string) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      const fallback = document.createElement('canvas')
      fallback.width = 2
      fallback.height = 2
      return new THREE.CanvasTexture(fallback)
    }
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    gradient.addColorStop(0, innerColor)
    gradient.addColorStop(1, outerColor)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }


  whitenAndShrinkPokemon(
    slot: PokemonSlot,
    durationMs: number = 350,
    options?: { targetScale?: number }
  ) {
    const actor = this.context.getActor(slot)
    if (!actor) return Promise.resolve()

    const startScale = actor.object.scale.clone()
    const targetScale = Math.max(options?.targetScale ?? 0.01, 0)
    const materials: Array<{
      material: THREE.MeshStandardMaterial
      color: THREE.Color
      emissive?: THREE.Color
    }> = []
    const white = new THREE.Color(0xffffff)
    const centerY = actor.object.position.y + startScale.y * actor.height * 0.5

    actor.object.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (!material || Array.isArray(material) || !('color' in material)) return
      materials.push({
        material,
        color: material.color.clone(),
        emissive: material.emissive ? material.emissive.clone() : undefined,
      })
    })

    return new Promise<void>((resolve) => {
      this.context.tweens.addCounter({
        from: 0,
        to: 1,
        duration: durationMs,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => {
          const t = Number(tween.getValue())
          const currentScaleY = THREE.MathUtils.lerp(startScale.y, targetScale, t)
          actor.object.scale.set(
            THREE.MathUtils.lerp(startScale.x, targetScale, t),
            currentScaleY,
            THREE.MathUtils.lerp(startScale.z, targetScale, t)
          )
          actor.object.position.y = centerY - currentScaleY * actor.height * 0.5
          materials.forEach(({ material, color, emissive }) => {
            material.color.copy(color).lerp(white, t)
            if (emissive) {
              material.emissive.copy(emissive).lerp(white, t * 0.5)
            }
            material.needsUpdate = true
          })
        },
        onComplete: () => {
          actor.object.scale.set(targetScale, targetScale, targetScale)
          resolve()
        },
      })
    })
  }

  restorePokemonAppearance(slot: PokemonSlot, durationMs: number = 350) {
    const actor = this.context.getActor(slot)
    if (!actor) return Promise.resolve()

    const targetScale = actor.object.scale.clone()
    const centerY = actor.object.position.y + actor.object.scale.y * actor.height * 0.5
    actor.object.scale.set(0.01, 0.01, 0.01)
    actor.object.position.y = centerY - 0.01 * actor.height * 0.5

    const materials: Array<{
      material: THREE.MeshStandardMaterial
      color: THREE.Color
      emissive?: THREE.Color
    }> = []
    const white = new THREE.Color(0xffffff)

    actor.object.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (!material || Array.isArray(material) || !('color' in material)) return
      materials.push({
        material,
        color: material.color.clone(),
        emissive: material.emissive ? material.emissive.clone() : undefined,
      })
      material.color.copy(white)
      if (material.emissive) {
        material.emissive.copy(white)
      }
      material.needsUpdate = true
    })

    return new Promise<void>((resolve) => {
      this.context.time.delayedCall(16, () => {
        this.context.tweens.addCounter({
          from: 0,
          to: 1,
          duration: durationMs,
          ease: 'Sine.easeInOut',
          onUpdate: (tween) => {
            const t = Number(tween.getValue())
            const currentScaleY = THREE.MathUtils.lerp(0.01, targetScale.y, t)
            actor.object.scale.set(
              THREE.MathUtils.lerp(0.01, targetScale.x, t),
              currentScaleY,
              THREE.MathUtils.lerp(0.01, targetScale.z, t)
            )
            actor.object.position.y = centerY - currentScaleY * actor.height * 0.5
            materials.forEach(({ material, color, emissive }) => {
              material.color.lerpColors(white, color, t)
              if (emissive) {
                material.emissive.lerpColors(white, emissive, t)
              }
              material.needsUpdate = true
            })
          },
          onComplete: () => {
            actor.object.scale.copy(targetScale)
            materials.forEach(({ material, color, emissive }) => {
              material.color.copy(color)
              if (emissive) {
                material.emissive.copy(emissive)
              }
              material.needsUpdate = true
            })
            resolve()
          },
        })
      })
    })
  }
}
