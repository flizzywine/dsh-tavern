// Shared upstream gate: an uncertain result is never an implicit retry grant.
export function needsPurchaseConfirmation(record) {
  return record?.outcome === 'unconfirmed' && !record.providerTask
}
export function checkPurchaseConfirmation(record, options = {}) {
  if (needsPurchaseConfirmation(record) && options.confirmNewRequestId !== record.requestId) {
    throw Object.assign(new Error('上次结果未确认，服务可能已计费。请确认重新生图后再请求，不会自动重试。'), {code:'BILLING_CONFIRMATION_REQUIRED', mayHaveCharged:true})
  }
}
