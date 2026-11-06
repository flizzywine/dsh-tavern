import {modError,MOD_RANGE_PATTERN} from './mod-system-contract.js'

const pattern=new RegExp(MOD_RANGE_PATTERN)
const compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0}
function tuple(value) {
  const parts=value.split('.').map(Number)
  if(parts.length!==3 || parts.some(n=>!Number.isSafeInteger(n) || n<0))throw modError('MOD_INVALID','Use safe stable semantic version components',{version:value})
  return parts
}
export function modRangeBounds(range) {
  if(typeof range!=='string' || !pattern.test(range))throw modError('MOD_INVALID','Use a stable exact version, ^x.y.z, ~x.y.z, or >=x.y.z <x.y.z',{range})
  if(range.startsWith('>=')) {
    const [from,to]=range.slice(2).split(' <'),min=tuple(from),max=tuple(to)
    if(compare(min,max)>=0)throw modError('MOD_INVALID','Version range upper bound must exceed its lower bound',{range})
    return {min,max}
  }
  const op=range[0],min=tuple(op==='^'||op==='~'?range.slice(1):range)
  if(op!=='^' && op!=='~')return {min,exact:true}
  const index=op==='~'?1:min[0]>0?0:min[1]>0?1:2,max=[...min]
  max[index]++;for(let i=index+1;i<3;i++)max[i]=0
  if(!Number.isSafeInteger(max[index]))throw modError('MOD_INVALID','Version upper bound exceeds supported precision',{range})
  return {min,max}
}
export function modVersionMatches(version,range) {
  const {min,max,exact}=modRangeBounds(range),actual=tuple(version)
  return exact?compare(actual,min)===0:compare(actual,min)>=0 && compare(actual,max)<0
}
