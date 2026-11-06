// Deployment reads the owners of work; timestamps and UI state are not work signals.
export function deploymentActivity({ foreground, background, director, progress, voice, choices, clipExport, calls }) {
  const reasons = []
  if (foreground) reasons.push('foreground')
  if (background?.busy || ['pending', 'running'].includes(background?.phase)) reasons.push('background')
  if (director?.busy) reasons.push('director')
  if (progress) reasons.push('plugin/background-progress')
  if (voice > 0) reasons.push('voice')
  if (calls > 0) reasons.push('phone-call')
  if (choices) reasons.push('candidate')
  if (clipExport?.busy || clipExport?.activeJobs > 0) reasons.push('clip-export')
  return { version: 1, busy: reasons.length > 0, reasons }
}
