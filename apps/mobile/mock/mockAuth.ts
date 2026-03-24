import { delay } from '@/lib/utils'

export async function mockLogin(email: string, password: string): Promise<{ userId: string; role: string }> {
  await delay(500)
  // Accept any credentials for mock
  const role = email.includes('dealer') ? 'dealer' : 'buyer'
  return { userId: 'user-1', role }
}

export async function mockRegister(email: string, password: string, role: string): Promise<{ userId: string }> {
  await delay(500)
  return { userId: 'user-1' }
}
