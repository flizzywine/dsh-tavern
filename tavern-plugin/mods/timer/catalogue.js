// Full refs remain canonical; no short-name resolver or hidden fallback entry.
export function timerCatalogueFragments(view) {
  const entries=view.packs.flatMap(pack=>pack.entries.map(entry=>({ref:[pack.id,'timers',entry.id].join('/'),name:entry.name})))
  return entries.length ? [{modId:'dsh.timer',id:'catalogue',type:'catalogue',source:'library',placement:{section:'director.catalogue',order:0},text:JSON.stringify({timers:entries})}] : []
}
