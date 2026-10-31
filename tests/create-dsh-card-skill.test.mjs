import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTavernSkillModule} from '../tavern-plugin/lib/domain/tavern-skills.js'
import {validateCardAssetExtension} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {effectiveCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'

test('DSH card skill is discoverable by workbench and its published declaration passes current validation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'dsh-card-skill-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const skills=createTavernSkillModule({directory,builtInDirectory:new URL('../presets/tavern/skills/',import.meta.url).pathname})
 const skill=await skills.read('create-dsh-card')
 assert.equal(skill.source,'builtin');assert.ok(skill.agents.includes('card'))
 const reference=await skills.readReference('create-dsh-card','references/format-and-stage.md')
 const declaration=JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1])
 validateCardAssetExtension(declaration)
 assert.equal(effectiveCardStage(declaration).stage,true)
 assert.match((await skills.read('create-card')).content,/`create-dsh-card`/)
})
