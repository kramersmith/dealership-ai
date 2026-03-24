import type { ApiService } from './types'
import { ApiClient } from './apiClient'

export const api: ApiService = new ApiClient()
