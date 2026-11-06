const templateFields=['variables_initialized','is_ejs_processed','template_display','template_rendered']
// `owned`: the caller made this Helper message for this projection alone (nothing else holds
// it), so its values move over instead of being copied once more. Per floor that saves a copy
// of every swipe's variables, which on a large MVU card is most of the floor.
export function projectTemplateMessage(message,{owned=false}={}){
 const copy=owned?value=>value:structuredClone
 return {mes:message.message,is_user:message.role==='user',is_system:message.role==='system',
  name:message.name||'',swipe_id:message.swipe_id,swipes:copy(message.swipes),
  variables:message.swipes_data.map(value=>value && typeof value==='object' && !Array.isArray(value)?copy(value):{}),
  ...Object.fromEntries(templateFields.filter(key=>Object.hasOwn(message.pluginData,key)).map(key=>[key,copy(message.pluginData[key])]))}
}
