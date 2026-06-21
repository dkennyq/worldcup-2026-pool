import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.database();

// FIFA API constants for World Cup 2026
const FIFA_COMPETITION_ID = '17'; // FIFA World Cup
const FIFA_SEASON_ID = '285023'; // 2026

interface Match {
  game: number;
  fifaId: string;
  homeScore: number;
  awayScore: number;
  matchTime: string | null;
  matchStatus: number;
}

interface Prediction {
  homePrediction: number;
  awayPrediction: number;
  points: number;
}

interface FifaMatch {
  IdMatch: string;
  Home: { Score: number | null };
  Away: { Score: number | null };
  MatchTime: string | null;
  MatchStatus: number;
}

interface FifaApiResponse {
  Results: FifaMatch[];
}

/**
 * Determine the winner of a match
 */
const getWinner = (home: number, away: number): 'home' | 'away' | 'tied' => {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'tied';
};

/**
 * Calculate points for a prediction
 * New system:
 * - 3k (3000): Exact score
 * - 2k (2000): Correct winner (not exact)
 * - 1k (1000): Correct draw (not exact)
 * - 0: Wrong result
 */
const calculatePoints = (
  homeScore: number,
  awayScore: number,
  homePrediction: number | null,
  awayPrediction: number | null
): number => {
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
};

/**
 * Scheduled function to fetch and update match scores from FIFA API
 * Runs every 1 minute during the tournament
 */
export const updateMatchScores = onSchedule('every 1 minutes', async () => {
  logger.info('Updating match scores from FIFA API...');

  try {
    const apiUrl = `https://api.fifa.com/api/v3/calendar/matches?idseason=${FIFA_SEASON_ID}&idcompetition=${FIFA_COMPETITION_ID}&count=500`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`FIFA API error: ${response.status}`);
    }

    const data = await response.json() as FifaApiResponse;

    // Get current matches from database
    const matchesSnapshot = await db.ref('matches').once('value');
    const matches = matchesSnapshot.val() as Record<string, Match> | null;

    if (!matches) {
      logger.warn('No matches found in database');
      return;
    }

    // Update scores for matching games
    const updates: Record<string, number | string | null> = {};

    for (const fifaMatch of data.Results) {
      for (const [gameId, match] of Object.entries(matches)) {
        if (match.fifaId === fifaMatch.IdMatch) {
          const homeScore = fifaMatch.Home?.Score ?? -1;
          const awayScore = fifaMatch.Away?.Score ?? -1;
          const matchTime = fifaMatch.MatchTime ?? null;
          const matchStatus = fifaMatch.MatchStatus ?? 1;

          if (match.homeScore !== homeScore && homeScore >= 0) {
            updates[`matches/${gameId}/homeScore`] = homeScore;
            logger.info(`Updated game ${gameId} home score: ${homeScore}`);
          }

          if (match.awayScore !== awayScore && awayScore >= 0) {
            updates[`matches/${gameId}/awayScore`] = awayScore;
            logger.info(`Updated game ${gameId} away score: ${awayScore}`);
          }

          if (match.matchTime !== matchTime) {
            updates[`matches/${gameId}/matchTime`] = matchTime;
            logger.info(`Updated game ${gameId} match time: ${matchTime}`);
          }

          if (match.matchStatus !== matchStatus) {
            updates[`matches/${gameId}/matchStatus`] = matchStatus;
            logger.info(`Updated game ${gameId} match status: ${matchStatus}`);
          }
        }
      }
    }

    // Apply all updates at once
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      logger.info(`Applied ${Object.keys(updates).length} score updates`);
    }
  } catch (error) {
    logger.error('Error updating match scores:', error);
  }
});

/**
 * Triggered when a match is updated
 * Recalculates prediction points for all users for that match
 */
export const updatePredictionPoints = onValueWritten(
  'matches/{matchId}',
  async (event) => {
    const matchId = event.params.matchId;
    const match = event.data.after.val() as Match | null;

    if (!match) {
      logger.warn(`Match ${matchId} was deleted`);
      return;
    }

    // Only recalculate if match has scores
    if (match.homeScore < 0 || match.awayScore < 0) {
      return;
    }

    logger.info(`Updating prediction points for match ${matchId}`);

    try {
      // Get all users
      const usersSnapshot = await db.ref('users').once('value');
      const users = usersSnapshot.val() as Record<string, unknown> | null;

      if (!users) {
        return;
      }

      const updates: Record<string, number> = {};

      // Calculate points for each user's prediction
      for (const userId of Object.keys(users)) {
        const predictionSnapshot = await db.ref(`predictions/${userId}/${matchId}`).once('value');
        const prediction = predictionSnapshot.val() as Prediction | null;

        if (prediction) {
          const points = calculatePoints(
            match.homeScore,
            match.awayScore,
            prediction.homePrediction,
            prediction.awayPrediction
          );

          if (prediction.points !== points) {
            updates[`predictions/${userId}/${matchId}/points`] = points;
            logger.info(`User ${userId}: ${points} points for match ${matchId}`);
          }
        }
      }

      // Apply all updates at once
      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
        logger.info(`Updated ${Object.keys(updates).length} prediction points`);
      }
    } catch (error) {
      logger.error('Error updating prediction points:', error);
    }
  }
);

/**
 * Triggered when a prediction is created or updated
 * Recalculates points if the match has scores
 * This allows admin to add/edit predictions for any match and get points calculated
 */
export const recalculatePredictionOnUpdate = onValueWritten(
  'predictions/{userId}/{matchId}',
  async (event) => {
    const { userId, matchId } = event.params;
    const before = event.data.before.val() as Prediction | null;
    const after = event.data.after.val() as Prediction | null;

    // If prediction was deleted or no data, exit
    if (!after) {
      return;
    }

    // If only the points changed (not the prediction values), exit to avoid loops
    if (
      before &&
      before.homePrediction === after.homePrediction &&
      before.awayPrediction === after.awayPrediction
    ) {
      return;
    }

    // Get the match to check if it has scores
    try {
      const matchSnapshot = await db.ref(`matches/${matchId}`).get();
      if (!matchSnapshot.exists()) {
        return;
      }

      const match = matchSnapshot.val() as Match;

      // Only recalculate if match has scores
      if (match.homeScore < 0 || match.awayScore < 0) {
        return;
      }

      // Calculate points
      const points = calculatePoints(
        match.homeScore,
        match.awayScore,
        after.homePrediction,
        after.awayPrediction
      );

      // Update points if they changed
      if (after.points !== points) {
        await db.ref(`predictions/${userId}/${matchId}/points`).set(points);
        logger.info(
          `Recalculated points for user ${userId}, game ${matchId}: ${points}`
        );
      }
    } catch (error) {
      logger.error('Error recalculating prediction points:', error);
    }
  }
);

/**
 * Triggered when prediction points change
 * Updates the user's total score
 */
export const updateUserScore = onValueWritten(
  'predictions/{userId}/{matchId}/points',
  async (event) => {
    const { userId } = event.params;
    const beforePoints = event.data.before.val() as number | null ?? 0;
    const afterPoints = event.data.after.val() as number | null ?? 0;

    // No change in points
    if (beforePoints === afterPoints) {
      return;
    }

    const pointsDiff = afterPoints - beforePoints;

    logger.info(`User ${userId} points changed: ${beforePoints} -> ${afterPoints} (diff: ${pointsDiff})`);

    try {
      const scoreSnapshot = await db.ref(`users/${userId}/score`).once('value');
      const currentScore = scoreSnapshot.val() as number | null ?? 0;
      const newScore = currentScore + pointsDiff;

      await db.ref(`users/${userId}/score`).set(newScore);
      logger.info(`User ${userId} total score: ${newScore}`);
    } catch (error) {
      logger.error('Error updating user score:', error);
    }
  }
);
