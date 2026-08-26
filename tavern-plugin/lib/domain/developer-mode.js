export function resolveDeveloperMode(environment = process.env) {
  return String(environment && environment.DSH_TAVERN_DEV_MODE || '').trim() === '1'
}
