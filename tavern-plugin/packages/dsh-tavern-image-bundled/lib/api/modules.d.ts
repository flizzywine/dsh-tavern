export type ModuleValue = string | number | boolean | null | ModuleValue[] | { [key: string]: ModuleValue };
export interface ModuleField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json';
  default?: ModuleValue; required?: boolean; min?: number; max?: number; step?: number;
  options?: Array<string | { value: string; label: string }>;
}
export interface ModuleContext {
  scene: string; usage: string; backend: string; values: Record<string, ModuleValue>;
  inputs: Record<string, string>; subjects: object[]; definitions: Record<string, unknown>; signal?: AbortSignal;
}
export interface ModuleParameters { seed?: number; steps?: number; cfg?: number; width?: number; height?: number }
export interface WorkflowValue { node: string; input: string; value: ModuleValue }
export interface ModuleContribution {
  positive?: string; negative?: string; rules?: string; parameters?: ModuleParameters; workflowValues?: WorkflowValue[];
}
export interface TemplateModuleDefinition {
  id: string; name: string; fields?: ModuleField[];
  resolve(context: ModuleContext): ModuleContribution | Promise<ModuleContribution>;
}
export interface ExtensionBlock { kind: 'extension'; title: string; moduleId: string; values: Record<string, ModuleValue>; usage?: string; enabled?: boolean }
export interface MaterializedModules {
  structure: object | undefined; parameters: ModuleParameters; workflowValues: WorkflowValue[];
  trace: Array<{ title: string; moduleId: string; parameters: ModuleParameters; workflowValues: WorkflowValue[] }>;
}
/** Register from a server-side plugin; dispose on plugin unload. The editor receives only the field schema. */
export function registerTemplateModule(definition: TemplateModuleDefinition): () => void;
export function listTemplateModules(): Array<Omit<TemplateModuleDefinition, 'resolve'>>;
export function normalizeModuleValues(value: unknown): Record<string, ModuleValue>;
export function materializeTemplateModules(structure: object | undefined, context?: Partial<ModuleContext>): MaterializedModules;
export function materializeTemplateModulesAsync(structure: object | undefined, context?: Partial<ModuleContext>): Promise<MaterializedModules>;
export function applyModuleWorkflowValues<T>(workflow: T, values?: WorkflowValue[]): T;
export function applyModuleParameters<T extends object>(params: T, parameters?: ModuleParameters): T & { seed?: number; steps?: number; cfg?: number; size?: string; moduleSize?: boolean };
