/** Dev login bypass — on by default in development; set AUTH_BYPASS_DEV=false to disable. */
export function isDevBypass(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_BYPASS_DEV !== 'false'
  )
}

export const DEV_USER_EMAIL = 'dev@apical.local'
export const DEV_USER_NAME = 'Developer'
