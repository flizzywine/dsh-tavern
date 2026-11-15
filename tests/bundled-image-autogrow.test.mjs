import test from 'node:test'
import assert from 'node:assert/strict'
import {compactComfySchema} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-inputs.js'
import {applyComfyReferenceImages} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-reference-images.js'
import {comfyReferenceCapacity} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-dynamic.js'

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

test('official prefix and named autogrow accept 1–5 references across positive and negative encoders', () => {
  for (const names of [false, true]) for (const legacy of [false, true]) for (const loaders of [1,5]) {
    const workflow = graph({names, legacy, loaders}), before = JSON.stringify(workflow)
    const maximum = legacy && loaders === 1 ? 1 : 5
    assert.equal(comfyReferenceCapacity(workflow, workflow.bindings.referenceImages), maximum)
    for (let count = 1; count <= maximum; count++) {
      checkPrompt(applyComfyReferenceImages(workflow, Array.from({length:count}, (_, i) => 'ref' + i + '.png')).prompt, count)
    }
    assert.equal(JSON.stringify(workflow), before)
  }
})

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

test('multiple explicit loaders expand up to the declared template maximum', () => {
  const workflow = graph({loaders:2, max:5})
  assert.equal(comfyReferenceCapacity(workflow, workflow.bindings.referenceImages), 5)
  checkPrompt(applyComfyReferenceImages(workflow, Array.from({length:5}, (_, i) => 'ref' + i + '.png')).prompt, 5)
})

test('a required first slot cannot be replaced by a later populated slot', () => {
  const workflow = graph({loaders:2})
  workflow.prompt.load1.inputs.image = 'existing.png'
  assert.throws(() => applyComfyReferenceImages(workflow, []), /至少需要 1 张参考图/)
})
