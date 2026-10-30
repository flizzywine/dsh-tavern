// Inventory is a read-only projection, not a second MVU store.
const aliases={name:['name','名称','物品名','名字'],count:['count','数量'],id:['id','标识'],owner:['owner','持有人']};
const pointer=key=>'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');
function inventoryCandidates(schema) {
  return schema.filter(row=>row.valueType==='array').flatMap(row=>{
    const sample=row.value?.[0],fields=row.recordFields || (sample && Object.fromEntries(Object.entries(sample).map(([key,value])=>[key,typeof value])));
    if(!fields)return [];
    const mapping={};
    for(const [key,names] of Object.entries(aliases)) {
      const matches=Object.keys(fields).filter(field=>names.includes(field) && fields[field]===(key==='count'?'number':'string'));
      if(matches.length===1)mapping[key]=pointer(matches[0]);
    }
    if(!mapping.name || !mapping.count)return [];
    return [{variable:{source:'mvu',path:row.path,fields:mapping},score:100,reasons:[{reason:'static-inventory-shape',points:100}]}];
  });
}
export const itemVariableProvider = {
  id:'items',label:'物品',
  slots() {
    return [{target:{kind:'items',slot:'inventory'},label:'背包',active:true,valueType:'array',default:[],
      fieldMapping:{name:{label:'名称',valueType:'string',required:true},count:{label:'数量',valueType:'number',required:true},
        id:{label:'稳定标识',valueType:'string',required:false},owner:{label:'持有人',valueType:'string',required:false}},
      candidates:inventoryCandidates,uniqueAuto:true,
    }];
  },
};
