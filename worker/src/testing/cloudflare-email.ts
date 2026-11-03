// Test stand-in for the Workers `cloudflare:email` module, which only exists inside the runtime.
// vitest.config.ts aliases the import to this file.
export class EmailMessage {
  constructor(
    readonly from: string,
    readonly to: string,
    readonly raw: string,
  ) {}
}
