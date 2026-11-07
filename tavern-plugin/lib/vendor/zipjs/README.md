# zip.js native build

Pinned upstream package: `@zip.js/zip.js@2.24.0`, BSD-3-Clause.
Source: https://registry.npmjs.org/@zip.js/zip.js/-/zip.js-2.24.0.tgz
Upstream: https://github.com/gildas-lormeau/zip.js

`zip-native.js` is the unmodified `index-native.min.js` from that package. It is used only on the host, with web workers disabled, for standard AES-encrypted card ZIPs. Plain card ZIPs keep Tavern's existing streamed reader. No network access or external archive executable is required at runtime. The upstream license is included.
