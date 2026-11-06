// All five official entry modules; avoid index.ts's automatic jQuery init so the host can await readiness.
import * as handler from '../upstream/src/modules/handler.ts'
import * as command from '../upstream/src/modules/command.ts'
import * as ui from '../upstream/src/modules/ui.ts'
import * as exports from '../upstream/src/modules/exports.ts'
import * as editor from '../upstream/src/modules/code-editor.ts'
export const modules = [handler, command, ui, exports, editor]
