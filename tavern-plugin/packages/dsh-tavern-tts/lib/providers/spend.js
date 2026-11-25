// The optional spend guard for paid requests. DSH_TAVERN_SPEND_MODULE names a module whose createApiSpend() returns
// check({category, purpose, channel, estimatedUsd}) → {id} (it throws to refuse the request) and release(id) (the provider
// certainly did not bill it). Without the variable paid requests go straight to the service: their limits are the
// provider account's own.
import { pathToFileURL } from 'node:url'

export async function loadSpend() {
  const module = process.env.DSH_TAVERN_SPEND_MODULE
  if (module) return (await import(pathToFileURL(module).href)).createApiSpend()
  return null
}
