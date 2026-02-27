const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ALLOWED_TEXT = /[^\w\s:;,.+\-_/()#@*=|]/g;

export class InputSanitizer {
  static sanitizeLine(raw: string): string {
    return raw.replace(CONTROL_CHARS, '').trim();
  }

  static sanitizeField(raw?: string): string | undefined {
    if (!raw) return undefined;
    return raw.replace(CONTROL_CHARS, '').replace(ALLOWED_TEXT, '').trim();
  }

  static isWhitelistedIp(ip: string, whitelist?: string[]): boolean {
    if (!whitelist || whitelist.length === 0) return true;
    return whitelist.includes(ip);
  }
}
