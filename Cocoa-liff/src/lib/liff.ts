// src/lib/liff.ts
import liff from '@line/liff'

export const LIFF_ID = import.meta.env.VITE_LIFF_ID as string

export async function initLiff(): Promise<{ userId: string; displayName: string }> {
  await liff.init({ liffId: LIFF_ID })

  if (!liff.isLoggedIn()) {
    liff.login()
    // จะ redirect ออกไป ไม่มีค่า return
    throw new Error('Redirecting to LINE login...')
  }

  const profile = await liff.getProfile()
  return {
    userId: profile.userId,
    displayName: profile.displayName,
  }
}

export function closeLiff() {
  liff.closeWindow()
}
