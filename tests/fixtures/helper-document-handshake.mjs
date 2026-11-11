export function announceHelperDocument(frame, receive, documentToken = 'test-document') {
  const bootstrapToken = JSON.parse(frame.srcdoc.match(/"token":("(?:[^"\\]|\\.)*")/)[1])
  receive({
    source: frame.contentWindow,
    data: { type: 'dsh-tavern-helper-document', token: bootstrapToken, documentToken }
  })
  return documentToken
}
