export type WeatherEffectType = 'rain' | 'snowscape' | 'sunnyday' | 'sandstorm' | 'deltastream'

export type WeatherTriggerRequest = {
  type?: WeatherEffectType
  durationMs?: number
  label?: string
  action?: 'start' | 'stop'
}

export type WeatherEventPayload = {
  id?: string
  type?: WeatherEffectType
  durationMs?: number
  label?: string
  action?: 'start' | 'stop'
}
