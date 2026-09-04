# Bundled Tavern browser runtime assets

These pinned files are shipped with dsh-tavern so card and MVU initialization does not depend on a CDN.
The corresponding license or notice is retained in each package directory.

- `@fortawesome/fontawesome-free@6.7.2`: `css/all.min.css`, required webfonts
- `@tailwindcss/browser@4.1.12`: `dist/index.global.js`
- `jquery@3.7.1`: `dist/jquery.min.js`
- `jquery-ui@1.14.1`: `dist/jquery-ui.min.js`, base theme and referenced images
- `jquery-ui-touch-punch@0.2.3`: `jquery.ui.touch-punch.min.js`
- `vue@3.5.41`: `dist/vue.runtime.global.prod.js`
- `vue-router@5.2.0`: `dist/vue-router.global.prod.js`
- `lodash@4.18.1`: `lodash.min.js`
- `zod@4.4.3`: jsDelivr `+esm` single-file browser bundle

The package files were retrieved from the exact pinned jsDelivr npm URLs previously used by the runtime.
