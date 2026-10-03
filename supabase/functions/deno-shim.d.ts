// Types for the Deno runtime and the one npm package the Edge Functions import, so the repo's TypeScript check passes.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
declare module 'npm:postgres@3' {
  const postgres: (url: string, opts?: Record<string, unknown>) => ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>) & { end(): Promise<void> };
  export default postgres;
}
