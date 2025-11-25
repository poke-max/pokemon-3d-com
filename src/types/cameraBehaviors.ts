export type AxisValueSpec =
  | number
  | 'current'
  | {
      type: 'relative'
      delta: number
    }

export type Vector3Spec = {
  x: AxisValueSpec
  y: AxisValueSpec
  z: AxisValueSpec
}

export type CameraLookAtSpec =
  | { type: 'actor'; id: string }
  | { type: 'point'; position: Vector3Spec }

export type CameraBehaviorRequest = {
  id: string
  initiatorId?: string
  label?: string
  camera: {
    position: Vector3Spec
    lookAt?: CameraLookAtSpec
    duration?: number
  }
  afterCameraActions?: CameraBehaviorAction[]
}

export type CameraBehaviorAction =
  | {
      type: 'moveActor'
      id: string
      position: Vector3Spec
    }
  | {
      type: 'moveActorAnimated'
      id: string
      position: Vector3Spec
      duration?: number
    }
  | {
      type: 'playAnimation'
      id: string
      animation: string
      onComplete?: CameraBehaviorAction[]
      midActions?: {
        at?: number
        delayMs?: number
        actions: CameraBehaviorAction[]
      }[]
    }
  | {
      type: 'playIdleRandom'
      id: string
    }
  | {
      type: 'resetCamera'
    }
  | {
      type: 'resetActorPosition'
      id: string
      duration?: number
    }
  | {
      type: 'freezeActors'
      ids: string[]
      duration: number
    }
  | {
      type: 'shakeCamera'
      duration: number
      intensity: number
    }
  | {
      type: 'freezeActors'
      ids: string[]
      duration: number
    }
