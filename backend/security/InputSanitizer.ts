const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ALLOWED_TEXT = /[^\w\s:;,.+\-_/()#@*=|?]/g;
const NON_ASCII = /[^\x00-\x7F]/g;

export class InputSanitizer {
  /**
   * Sanitize SMDR record line
   * - Removes control characters
   * - Replaces non-ASCII characters with '?' (per Mitel spec for non-telephony digits)
   * - Preserves spacing for fixed-width parsing
   */
  static sanitizeLine(raw: string): string {
    return raw
      .replace(CONTROL_CHARS, '')
      .replace(NON_ASCII, '?');  // Replace non-ASCII with ? per Mitel spec
  }

  /**
   * Sanitize individual field value
   * - Removes control characters
   * - Removes disallowed special characters
   * - Preserves alphanumeric and common telephony symbols (*, #, +)
   */
  static sanitizeField(raw?: string): string | undefined {
    if (!raw) return undefined;
    return raw
      .replace(CONTROL_CHARS, '')
      .replace(ALLOWED_TEXT, '')
      .trim();
  }

  static isWhitelistedIp(ip: string, whitelist?: string[]): boolean {
    if (!whitelist || whitelist.length === 0) return true;
    return whitelist.includes(ip);
  }
}
