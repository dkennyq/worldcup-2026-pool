/**
 * Format score for display as Colombian pesos
 * Example: 29000 -> $29.000
 */
export function formatScore(score: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(score);
}

/**
 * Format individual points for match cards
 * Example: 3000 -> 3k
 */
export function formatPoints(points: number): string {
  if (points === 0) return '0';
  if (points >= 1000) {
    return `${points / 1000}k`;
  }
  return String(points);
}
