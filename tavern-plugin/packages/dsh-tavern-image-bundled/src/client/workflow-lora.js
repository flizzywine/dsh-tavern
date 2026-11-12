    const imageLoraKey = binding => binding.slot ? String(binding.node) + ':' + binding.slot : String(binding.node)

    function WorkflowLoraWeight({ label, value, onSave }) {
      const [draft, setDraft] = React.useState(null)
      return promptField(label, h('input', { type: 'number', step: 0.05, style: { ...S.input, width: 76 }, value: draft ?? value ?? '',
        onChange: event => setDraft(event.target.value),
        onBlur: () => {
          if (draft?.trim() && Number.isFinite(Number(draft)) && Number(draft) !== value) onSave(Number(draft))
          setDraft(null)
        },
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() } }))
    }
