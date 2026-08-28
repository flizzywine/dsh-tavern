export const SILLYTAVERN_CSS_COMPAT_VERSION = '1.18.0'
export const SILLYTAVERN_CSS_COMPAT_REVISION = '8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8'

export const SILLYTAVERN_CSS_COMPAT_PATHS = Object.freeze([
  'webfonts/NotoSans/stylesheet.css',
  'webfonts/NotoSansMono/stylesheet.css',
  'css/fontawesome.min.css',
  'css/solid.min.css',
  'css/brands.min.css',
  'css/jquery-ui.min.css',
  'css/bright.min.css',
  'css/cropper.min.css',
  'css/toastr.min.css',
  'css/select2.min.css',
  'style.css',
  'css/st-tailwind.css',
  'css/rm-groups.css',
  'css/group-avatars.css',
  'css/toggle-dependent.css',
  'css/world-info.css',
  'css/extensions-panel.css',
  'css/select2-overrides.css',
  'css/mobile-styles.css',
  'css/macros.css'
])

const base = 'https://cdn.jsdelivr.net/gh/SillyTavern/SillyTavern@' + SILLYTAVERN_CSS_COMPAT_REVISION + '/public/'
export const SILLYTAVERN_CSS_COMPAT_URLS = Object.freeze(SILLYTAVERN_CSS_COMPAT_PATHS.map(function (path) { return base + path }))
