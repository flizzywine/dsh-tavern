export interface LibraryContext { card?: string; characterId?: string }
export interface LibraryDetail { name: string; text: string; useForImage: boolean }
export interface LibraryCharacter {
  id: string; name: string; aliases: string[]; description: string; group: string;
  comfyLoras?: Array<{ workflowId: string; node?: string; name: string; strengthModel?: number; strengthClip?: number; enabled?: boolean }>;
  traits: Record<string, string>; outfitIds: string[]; imagePrompt?: string; imageDetails?: LibraryDetail[];
}
export interface LibraryOutfit {
  id: string; name: string; characterId: string | null;
  parts: Record<'upper' | 'lower' | 'shoes' | 'accessory' | 'full' | 'back', string>;
  negative: string; isDefault: boolean; imagePrompt?: string; imageDetails?: LibraryDetail[];
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
