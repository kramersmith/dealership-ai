import type { ApiService } from './types'
import { MockApiService } from '@/mock/mockApi'
import { ApiClient } from './apiClient'

// Toggle between mock and real backend:
// - true  = use mock data (no backend needed)
// - false = use real FastAPI backend on localhost:8001
const USE_MOCK = true

export const api: ApiService = USE_MOCK ? new MockApiService() : new ApiClient()
