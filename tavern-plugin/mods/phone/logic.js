import device from './builtin/device.json' with {type:'json'}

// Builtins and uploaded settings are presentation resources, never recall candidates.
export function withBuiltinPhoneDevice(catalogue) {
  return {...catalogue,phone:{device:structuredClone(device.ref),...catalogue.phone}}
}
export function phoneDevices(catalogue) {
  return catalogue.phone?.device?[catalogue.phone.device]:[]
}
