// Transport for upstream's optional worker compiler; use its pinned EJS dependency.
import ejs from '../upstream/src/3rdparty/ejs.js'
self.onmessage = ({ data: { id, template, options } }) => {
  try { self.postMessage({ id, code: ejs.compile(template, options).toString() }) }
  catch (error) { self.postMessage({ id, error: String(error.message || error) }) }
}
