// generation consumes declarations; opaque IDs never imply an expression.
export function assetSheetEmotionIds(figure,outfit) {return (figure?.emotions || []).map(row=>row.id).filter(id=>!outfit?.fallbackEmotions?.includes(id));}
export function assetEmotionGuidance(emotion,figure) {
 const row=figure?.emotions?.find(row=>row.id===emotion.id)||emotion;
 return [row.generationGuidance,row.guidance].filter(Boolean).join('\n');
}
