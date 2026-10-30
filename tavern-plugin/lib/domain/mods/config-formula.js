const functions = {min:[1,32],max:[1,32],round:[1,1],floor:[1,1],ceil:[1,1],abs:[1,1],clamp:[3,3]}
const fail = (code,message,position) => { throw Object.assign(new Error(message),{code,position}) }
const errorOf = error => ({code:error.code || 'FORMULA_TYPE',message:error.message,position:error.position ?? 0})

// A bounded recursive-descent grammar; tokens retain input offsets for editor diagnostics.
export function parseFormula(text) {
  try {
    if (typeof text !== 'string' || text.length > 4096) fail('FORMULA_SYNTAX','Formula must contain at most 4096 characters',0)
    let i=0, count=0, depth=0
    const skip=()=>{while (/\s/.test(text[i] || '') && i<text.length)i++}
    const node=(value)=>{if(++count>512)fail('FORMULA_SYNTAX','Formula is too complex',i);return value}
    function primary() {
      skip();const position=i, ch=text[i]
      if(++depth>48)fail('FORMULA_SYNTAX','Parentheses are nested too deeply',i)
      let result
      if(ch==='(') {i++;result=expression();skip();if(text[i++]!==')')fail('FORMULA_SYNTAX','Expected closing parenthesis',i-1)}
      else if(ch==='+' || ch==='-' || ch==='\u2212') {i++;result=node({type:'unary',op:ch==='+'?'+':'-',child:primary(),position})}
      else if(ch==='{') {
        const end=text.indexOf('}',++i)
        if(end<0)fail('FORMULA_SYNTAX','Unclosed source reference',position)
        const match=/^(mvu|ledger|helper-chat|stage|mod:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+):(\/.*)$/.exec(text.slice(i,end))
        if(!match)fail('FORMULA_SYNTAX','Expected {source:/JSON/Pointer}',position)
        i=end+1;result=node({type:'ref',source:match[1],path:match[2],position})
      } else if(ch==='"') {
        i++;let closed=false
        while(i<text.length) {if(text[i]==='\\'){i+=2;continue}if(text[i++]==='"'){closed=true;break}}
        if(!closed)fail('FORMULA_SYNTAX','Unclosed string',position)
        let value;try {value=JSON.parse(text.slice(position,i))}catch{fail('FORMULA_SYNTAX','Invalid string escape',position)}
        result=node({type:'literal',value,position})
      } else {
        const number=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i))
        const name=/^[a-zA-Z_][a-zA-Z_0-9]*/.exec(text.slice(i))
        if(number) {i+=number[0].length;const value=Number(number[0]);if(!Number.isFinite(value))fail('FORMULA_MATH','Number is not finite',position);result=node({type:'literal',value,position})}
        else if(name) {
          i+=name[0].length;skip()
          if(!Object.hasOwn(functions,name[0]))fail('FORMULA_SYNTAX','Unknown function: '+name[0],position)
          if(text[i++]!=='(')fail('FORMULA_SYNTAX','Expected function arguments',i-1)
          const args=[];skip()
          if(text[i]!==')')while(true){args.push(expression());skip();if(text[i]!==',')break;i++}
          if(text[i++]!==')')fail('FORMULA_SYNTAX','Expected closing parenthesis',i-1)
          const [min,max]=functions[name[0]]
          if(args.length<min || args.length>max)fail('FORMULA_SYNTAX',name[0]+' expects '+(min===max?min:min+' to '+max)+' arguments',position)
          result=node({type:'call',name:name[0],args,position})
        } else fail('FORMULA_SYNTAX',i===text.length?'Expected a value':'Unexpected character: '+ch,position)
      }
      depth--;return result
    }
    function product() {let left=primary();skip();while(['*','/','\u00d7','\u00f7'].includes(text[i])){const position=i,op=['*','\u00d7'].includes(text[i++])?'*':'/';left=node({type:'binary',op,left,right:primary(),position});skip()}return left}
    function expression() {let left=product();skip();while(['+','-','\u2212'].includes(text[i])){const position=i,op=text[i++]==='+'?'+':'-';left=node({type:'binary',op,left,right:product(),position});skip()}return left}
    const ast=expression();skip();if(i!==text.length)fail('FORMULA_SYNTAX','Unexpected character: '+text[i],i)
    return {ast}
  } catch(error) {return {error:errorOf(error)}}
}

export async function evaluateFormula(input,readReference) {
  const parsed=typeof input==='string'?parseFormula(input):{ast:input}
  if(parsed.error)return parsed
  try {
    const numeric=(value,position)=>{if(typeof value!=='number' || !Number.isFinite(value))fail('FORMULA_TYPE','Expected a finite number',position);return value}
    let budget=1024
    async function visit(node) {
      if(!node || --budget<0)fail('FORMULA_SYNTAX','Invalid or excessive formula tree',node?.position || 0)
      const p=node.position
      if(node.type==='literal')return node.value
      if(node.type==='ref') {
        try {const value=await readReference({source:node.source,path:node.path});if(!['number','string'].includes(typeof value))fail('FORMULA_TYPE','Reference must be a number or string',p);return value}
        catch(error) {throw Object.assign(error,{position:p})}
      }
      if(node.type==='unary')return (node.op==='-'?-1:1)*numeric(await visit(node.child),p)
      if(node.type==='binary') {
        const a=await visit(node.left), b=await visit(node.right)
        if(node.op==='+' && (typeof a==='string' || typeof b==='string'))return String(a)+String(b)
        numeric(a,p);numeric(b,p)
        if(node.op==='/' && b===0)fail('FORMULA_MATH','Division by zero',p)
        const value=node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:a/b
        if(!Number.isFinite(value))fail('FORMULA_MATH','Result is not finite',p)
        return value
      }
      if(node.type==='call' && Object.hasOwn(functions,node.name)) {
        const args=[];for(const child of node.args)args.push(numeric(await visit(child),p))
        if(node.name==='clamp') {if(args[1]>args[2])fail('FORMULA_MATH','Clamp minimum exceeds maximum',p);return Math.min(args[2],Math.max(args[1],args[0]))}
        return Math[node.name](...args)
      }
      fail('FORMULA_SYNTAX','Invalid formula node',p)
    }
    return {value:await visit(parsed.ast)}
  } catch(error) {return {error:errorOf(error)}}
}
