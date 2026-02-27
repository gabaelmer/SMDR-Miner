/**
 * Format a number as currency
 */
export function formatCurrency(amount: number, currency: string = 'PHP', locale: string = 'en-PH'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(amount);
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(num: number, locale: string = 'en-PH'): string {
  return new Intl.NumberFormat(locale).format(num);
}

/**
 * Format a number as percentage
 */
export function formatPercent(value: number, locale: string = 'en-PH'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Parse currency string to number (e.g., "₱1,234.56" -> 1234.56)
 */
export function parseCurrency(value: string, currency: string = 'PHP'): number {
  const currencySymbols: Record<string, string> = {
    PHP: '₱',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥'
  };
  
  const symbol = currencySymbols[currency] || currency;
  const cleaned = value
    .replace(symbol, '')
    .replace(/,/g, '')
    .trim();
  
  return parseFloat(cleaned) || 0;
}
