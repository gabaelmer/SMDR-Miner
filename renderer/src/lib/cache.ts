/**
 * Simple In-Memory Cache for API Responses
 * Provides basic caching without external dependencies
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<any>>();

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache entry with expiration
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttlMs - Time to live in milliseconds (default: 5 minutes)
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttlMs
    });
  }

  /**
   * Remove cached entry
   */
  remove(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    const now = Date.now();
    const validKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiresAt) {
        validKeys.push(key);
      } else {
        this.cache.delete(key);
      }
    }
    
    return {
      size: validKeys.length,
      keys: validKeys
    };
  }
}

// Singleton instance
export const apiCache = new SimpleCache();

/**
 * Generate cache key from filters
 */
export function generateCacheKey(prefix: string, filters: Record<string, unknown>): string {
  return `${prefix}:${JSON.stringify(filters)}`;
}
