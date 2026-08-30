declare module '*?raw' {
    const content: string;
    export default content;
}
declare module '*?url' {
    const content: string;
    export default content;
}
declare module '*.html' {
    const content: string;
    export default content;
}
declare module '*.md' {
    const content: string;
    export default content;
}
declare module '*.css' {
    const content: unknown;
    export default content;
}
declare module '*.vue' {
    import { DefineComponent } from 'vue';
    const component: DefineComponent;
    export default component;
}

declare const YAML: typeof import('yaml');

declare const z: typeof import('zod');
declare namespace z {
    export type infer<T> = import('zod').infer<T>;
    export type input<T> = import('zod').input<T>;
    export type output<T> = import('zod').output<T>;
}

declare const __BUILD_DATE__: string | undefined;
declare const __COMMIT_ID__: string | undefined;
