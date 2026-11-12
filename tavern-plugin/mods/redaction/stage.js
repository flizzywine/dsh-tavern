import {createRedactionExtension} from './host/extension.js'

// The redaction mod's part of the director transaction (tavern-plugin/lib/domain/mods/stage-contributions.js).
export default {
  // A mark without a kind records the card's default (runtime.js configure puts it on the admission), so every view
  // shows the kind the director saw.
  admitParams(command, params) {
    return params.kind || !command.admission?.kind ? params : {...params, kind:command.admission.kind}
  },
  hostExtension:createRedactionExtension,
}
