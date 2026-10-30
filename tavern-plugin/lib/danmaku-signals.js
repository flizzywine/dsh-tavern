import {stageDisplayUnits} from './domain/stage-display-units.js'
import bubbles from '../src/client/bubble-line.cjs'

// Read only the displayed turn and preceding narration, never a future page or a whole-round speaker set.
export function corpusPageSignals(pages,sourceUnits=[],turn) {
  const text=sourceUnits.filter(u=>u.turn===turn).map(u=>u.text).join('\n\n')
  const units=stageDisplayUnits([{kind:'markdown',text}])
  return pages.map(page=>{
    const paragraph=page.anchor?.paragraph??page.paragraph,unit=units[paragraph-1]
    const bubble=unit?.kind==='line'?bubbles.parseBubbles(unit.text).find(b=>b.kind==='bubble'):null
    const prior=units[paragraph-2]
    const hints=page.signals||{}
    if(bubble && !bubble.text.includes(page.text))return {...page,signals:hints}
    return {...page,signals:{...hints,...(bubble?{mood:bubble.mood,speakers:[bubble.name||bubble.alias]}:{}),
      ...(unit?.kind==='line'&&prior?.kind==='narration'?{narration:prior.text}:{})}}
  })
}
