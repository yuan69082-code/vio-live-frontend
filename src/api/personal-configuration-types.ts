/** Response projections of backend personal-configuration-service; no secrets. */
export type PersonalProviderRecord = {
  providerId: string; displayName: string; providerType: string; baseUrl: string
  interfaceFormat: string; status: 'enabled' | 'disabled'; version: number
  credentials: { apiKey: { status: string; storage: string; masked?: string } }
}
export type PersonalModel = {
  modelId: string; providerId: string; modelName: string; modelType: string
  capabilities: string[]; costDescription: string; testStatus: string
  status: 'enabled' | 'disabled'; version: number; defaultForChat: boolean
}
export type ConnectionTest = { testId: string; providerId: string; scope: 'authentication'; status: string; reason: string | null; startedAt: string; completedAt: string | null; generation: 'not_performed'; providerCharge: 'not_incurred' }
