declare module '@deepseek-ai/dsh-typert-protocol' {
  export abstract class TypertRemoteService {
    protected readonly ctx: import('@deepseek-ai/cordis').Context
    constructor(ctx: import('@deepseek-ai/cordis').Context, serviceKey: string, options?: { namespace?: string })
  }

  export function Remote(options: { mode: 'stream' }): <T>(method: T, context: ClassMethodDecoratorContext) => void
}
