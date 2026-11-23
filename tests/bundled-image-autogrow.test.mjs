import test from 'node:test'
import assert from 'node:assert/strict'
import {compactComfySchema} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-inputs.js'
import {applyComfyReferenceImages} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-reference-images.js'

function graph({names = false, min = 1, loaders = 5, max = 5, legacy = false} = {}) {
  const template = {input:{required:{image:['IMAGE']}}, min,
    ...(names ? {names:Array.from({length:max}, (_, i) => 'image_' + i)} : {prefix:'image_', max})}
  const schema = compactComfySchema({input:{required:{images:['COMFY_AUTOGROW_V3', {template}]}}, output:['CONDITIONING']})
  if (legacy) schema.inputs = {images:{type:'COMFY_AUTOGROW_V3', optional:false}}
  const workflow = {outputNode:'out', nodeSchemas:{
    LoadImage:{inputs:{image:{type:'COMBO', imageUpload:true}}, outputs:['IMAGE','MASK']},
    Scale:{inputs:{image:{type:'IMAGE'}}, outputs:['IMAGE']}, Encode:schema,
    SaveImage:{inputs:{positive:{type:'CONDITIONING'}, negative:{type:'CONDITIONING'}}, outputNode:true, outputs:[]},
  }, prompt:{positive:{class_type:'Encode', inputs:{}}, negative:{class_type:'Encode',inputs:{}},
    out:{class_type:'SaveImage', inputs:{positive:['positive',0],negative:['negative',0]}}}, bindings:{referenceImages:[]}}
  for (let i = 0; i < loaders; i++) {
    workflow.prompt['load' + i] = {class_type:'LoadImage', inputs:{image:''}}
    workflow.prompt['scale' + i] = {class_type:'Scale', inputs:{image:['load' + i,0]}}
    for (const id of ['positive','negative']) workflow.prompt[id].inputs['images.image_' + i] = ['scale' + i,0]
    workflow.bindings.referenceImages.push({node:'load' + i,input:'image'})
  }
  return workflow
}
function checkPrompt(prompt, count) {
  for (const id of ['positive','negative']) {
    assert.equal(Object.keys(prompt[id].inputs).length, count)
    for (let i = 0; i < count; i++) {
      const branch = prompt[id].inputs['images.image_' + i]
      assert.equal(prompt[prompt[branch[0]].inputs.image[0]].inputs.image, 'ref' + i + '.png')
      assert.deepEqual(branch, prompt.positive.inputs['images.image_' + i])
    }
  }
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'LoadImage').length, count)
  for (const node of Object.values(prompt)) for (const value of Object.values(node.inputs)) {
    if (Array.isArray(value)) assert.ok(prompt[value[0]], 'no dangling links')
  }
}

test('autogrow preserves the declared minimum, including zero and more than one', () => {
  for (const loaders of [1,5]) for (const min of [0,1,2]) {
    const workflow = graph({loaders,min})
    if (min) assert.throws(() => applyComfyReferenceImages(workflow, []), new RegExp('至少需要 ' + min + ' 张参考图'))
    else checkPrompt(applyComfyReferenceImages(workflow, []).prompt, 0)
    if (min === 2) assert.throws(() => applyComfyReferenceImages(workflow, ['ref0.png']), /至少需要 2 张参考图/)
    checkPrompt(applyComfyReferenceImages(workflow, ['ref0.png','ref1.png']).prompt, 2)
  }
  assert.throws(() => applyComfyReferenceImages(graph({loaders:1}), Array(6).fill('ref.png')), /最多支持 5 张/)
})
