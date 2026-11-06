const freezeCoreTimeParams = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freezeCoreTimeParams); Object.freeze(value) } return value }
const CORE_TIME_PARAMS = freezeCoreTimeParams({
  day: {},
  dusk: {gain:[1,0.86,0.72],lift:[0.03,0.008,0],saturation:1.06,standIn:{contrast:0.95,gain:[0.84,0.76,0.7],lift:[0.016,-0.006,-0.0075]}},
  night: {contrast:1.04,gain:[0.74,0.79,0.97],saturation:0.8,standIn:{contrast:0.9,gain:[0.48,0.54,0.74],lift:[-0.026,-0.019,0.005],saturation:0.78}}
})
if(typeof module!=='undefined' && typeof window === 'undefined')module.exports={CORE_TIME_PARAMS};
