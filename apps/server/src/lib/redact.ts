/**
 * Replaces secret values with `[secret:NAME]` in streamed text.
 * A secret can arrive split across chunks, so a tail that could still become a secret is held back until more text arrives.
 */
export class Redactor {
  private held = '';
  private readonly entries: Array<[name: string, value: string]>;

  constructor(secrets: Record<string, string>) {
    this.entries = Object.entries(secrets)
      .filter(([, value]) => value.length >= 4)
      .sort((a, b) => b[1].length - a[1].length);
  }

  /** Redact a complete string. */
  apply(text: string): string {
    return this.entries.reduce((out, [name, value]) => out.split(value).join(`[secret:${name}]`), text);
  }

  /** Redact the next chunk of a stream. */
  push(chunk: string): string {
    const text = this.apply(this.held + chunk);
    const keep = this.partialSecretLength(text);
    this.held = text.slice(text.length - keep);
    return text.slice(0, text.length - keep);
  }

  flush(): string {
    const rest = this.held;
    this.held = '';
    return rest;
  }

  private partialSecretLength(text: string): number {
    let longest = 0;
    for (const [, value] of this.entries) {
      for (let n = Math.min(value.length - 1, text.length); n > longest; n--) {
        if (text.endsWith(value.slice(0, n))) {
          longest = n;
          break;
        }
      }
    }
    return longest;
  }
}
