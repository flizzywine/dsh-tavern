export type PhoneMarker = { op: 'phone.message'; side: 'in' | 'out'; form?: 'text' | 'voice' } & ({contact:string; to?:string; thread?:never; sender?:never} | {thread:string; sender:string; contact?:never; to?:never});
export interface PhoneGroup { id:string; name:string; participants:string[] }
export interface PhonePage { para: number; kind: string; alias?: string; name?: string }
// source names resolve to the canonical alias before marker projection.
export interface PhoneCharacter { alias: string; name?: string; aliases?: string[]; enabled?: boolean; ref?: { packId: string; figureId: string } }
export interface Rect { x: number; y: number; width: number; height: number }
export interface PhoneProjection<P extends PhonePage> {
  active: boolean; current: PhoneMarker | null; messages: { line: P; mark: PhoneMarker; continued: boolean }[]; key: string;
  contact?: string; first?: number; last?: number;
}
export function phoneModMarker(raw: unknown, unit: PhonePage, characters: PhoneCharacter[], threads?: Record<string,PhoneGroup>): PhoneMarker | null;
export function phoneModSourceMarker(raw:{to?:string;thread?:string;form:'text'|'voice'},unit:Pick<PhonePage,'kind'|'alias'|'name'>,characters:PhoneCharacter[],threads?:Record<string,PhoneGroup>,playerId?:string|null):PhoneMarker|null;
export function phoneModDirect(mark: {contact:string; to?:string; side:'in'|'out'},playerId?:string|null): {threadId:string; sender:string; recipient:string; participants:string[]};
export interface PhoneThreadMessage { sender:string; side:'in'|'out'; recipient?:string|null; [key:string]:unknown }
export interface PhoneThread { id:string; kind:'direct'|'group'; name:string; participants:{id:string;name:string}[]; messages?:PhoneThreadMessage[]; typing?:PhoneThreadMessage|null; [key:string]:unknown }
export function phoneModOwnership(threads:PhoneThread[],latestMessage?:{recipient?:string|null}|null,playerId?:string|null): {phones:{id:string;name:string;threads:PhoneThread[]}[];latestRecipientPhoneId:string|null};
export function phoneModProjection<P extends PhonePage>(pages: P[], at: number, record: { status: string; key: string; entries: { at: number; commands?: unknown[] }[] }, characters: PhoneCharacter[]): PhoneProjection<P>;
export function phoneModSize(width: number): { screenWidth: number; width: number; height: number };
export function phoneModPlace(options: { width: number; height: number; figures?: unknown[]; blocked?: Rect[]; size: { width: number; height: number }; previous?: Rect }): Rect | null;
export function phoneModLayout(options: { width: number; height: number; figures?: unknown[]; blocked?: Rect[]; caption?: Rect; previous?: Rect; compactPrevious?: Rect }): (Rect & { compact: boolean }) | null;
