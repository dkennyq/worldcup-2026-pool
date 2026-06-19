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

type Winner = 'home' | 'away' | 'tied';

const getWinner = (home: number, away: number): Winner => {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'tied';
};

/**
 * Calculate points for a prediction based on match scores
 * New system:
 * - 3k (3000): Exact score
 * - 2k (2000): Correct winner (not exact)
 * - 1k (1000): Correct draw (not exact)
 * - 0: Wrong result
 */
export function calculatePoints(
  homeScore: number,
  awayScore: number,
  homePrediction: number | null,
  awayPrediction: number | null
): number {
  // No prediction or match not played yet
  if (homeScore < 0 || homePrediction === null || awayPrediction === null) {
    return 0;
  }

  // Exact score: 3k
  if (homeScore === homePrediction && awayScore === awayPrediction) {
    return 3000;
  }

  const actualWinner = getWinner(homeScore, awayScore);
  const predictedWinner = getWinner(homePrediction, awayPrediction);

  if (actualWinner === predictedWinner) {
    // Correct draw (not exact): 1k
    if (actualWinner === 'tied') {
      return 1000;
    }
    // Correct winner (not exact): 2k
    return 2000;
  }

  // Wrong result: 0
  return 0;
}
