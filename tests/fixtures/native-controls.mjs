// The client's shared controls live at the bundle's outer level (inline-field.js, stage-load-progress.cjs); a test
// that slices one feature out of client.js has to supply them. They are loaded from their real source, except
// InlineField menus and Slider: those custom widgets have their own tests, and panel tests drive the panel's
// logic through native stand-ins with the same props (an <input> for text and numbers, a <select> grouped by
// `group` for menus, an <input type=range>).
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')
const SHARED = ['InlineGrid', 'InlineRow', 'SearchBox', 'PanelBoundary', 'EmptyState', 'Switch', 'Segmented', 'TextArea', 'InlineAdd', 'PanelLoading']

export function clientControls(React) {
  const shared = new Function('React', read('inline-field.js') + '\n' + read('stage-load-progress.cjs') + '\nreturn {' + SHARED.join(',') + '}')(React)
  const h = React.createElement
  function InlineField(props) {
    // text / number: a labelled native input that commits as it is typed.
    if (props.kind === 'text' || props.kind === 'number') return h('label', { className: props.className }, props.label,
      h('input', { type: props.kind, value: props.value ?? '', disabled: props.disabled, onChange: event => {
        const text = event.target.value
        props.onCommit?.(props.kind === 'number' ? (text.trim() === '' ? null : Number(text)) : text)
      } }))
    const groups = []
    for (const option of props.options || []) {
      let group = groups.find(row => row.label === (option.group || ''))
      if (!group) groups.push(group = { label: option.group || '', rows: [] })
      group.rows.push(option)
    }
    const option = row => h('option', { key: row.value, value: row.value }, row.label)
    return h('select', { className: props.className, value: props.value, disabled: props.disabled, 'aria-label': props.label,
      onChange: event => props.onCommit?.(event.target.value) },
    groups.flatMap(group => group.label ? [h('optgroup', { key: group.label, label: group.label }, group.rows.map(option))] : group.rows.map(option)))
  }
  function Slider(props) {
    const commit = props.onCommit || props.onChange
    return h('input', { type: 'range', min: props.min, max: props.max, step: props.step, value: props.value, disabled: props.disabled, 'aria-label': props.label,
      onChange: event => commit?.(Number(event.target.value)) })
  }
  return { ...shared, InlineField, Slider }
}
