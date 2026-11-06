export interface LibraryContext { card?: string; characterId?: string }
export interface LibraryCharacter {
  id: string; name: string; aliases: string[]; description: string; group: string;
  traits: Record<string, string>; outfitIds: string[];
}
export interface LibraryOutfit {
  id: string; name: string; characterId: string | null;
  parts: Record<'upper' | 'lower' | 'shoes' | 'accessory' | 'full' | 'back', string>;
  negative: string; isDefault: boolean;
}
export interface ImageLibrary {
  id: string; label: string;
  characters(context?: LibraryContext): LibraryCharacter[];
  outfits(context?: LibraryContext): LibraryOutfit[];
}
/** Live read-only projections. The caller owns persistence and optional schema-4 record methods. */
export function createImageLibrary<T extends object = object>(
  getDefinitions: () => { characters?: object[]; outfits?: object[] }, records?: T
): ImageLibrary & T;
export { createImageLibrary as imageLibraryProvider };
