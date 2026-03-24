import type { ApiService } from './types'
import { MockApiService } from '@/mock/mockApi'

// Swap this one line when the backend is ready:
// import { RealApiService } from './realApi'
// export const api: ApiService = new RealApiService()

export const api: ApiService = new MockApiService()
