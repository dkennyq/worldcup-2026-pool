/**
 * Rollback Points Script - Revert to old scoring system (15/10-variable/0)
 *
 * Prerequisites:
 * 1. Place service-account.json in project root
 * 2. Run: node utils/rollback-points.js
 *
 * This script reads all predictions, recalculates points using the
 * OLD scoring system, and updates them back.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
const DATABASE_URL = 'https://arenavault-d9f7f-default-rtdb.firebaseio.com';

function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✅';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function initializeApp() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`\n❌ Service account key not found!\n`);
    process.exit(1);
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });

  log('info', 'Firebase Admin SDK initialized');
  return admin.database();
}

function getWinner(home, away) {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'tied';
}

function calculateOldPoints(homeScore, awayScore, homePrediction, awayPrediction) {
  if (homeScore < 0 || homePrediction === null || awayPrediction === null) {
    return 0;
  }

  // Exact score: 15 points
  if (homeScore === homePrediction && awayScore === awayPrediction) {
    return 15;
  }

  // Correct winner: 10 points minus difference (min 0)
  if (getWinner(homeScore, awayScore) === getWinner(homePrediction, awayPrediction)) {
    const difference = Math.abs(homePrediction - homeScore) + Math.abs(awayPrediction - awayScore);
    return Math.max(0, 10 - difference);
  }

  // Wrong winner: 0 points
  return 0;
}

async function rollbackPoints(db) {
  log('info', 'Starting rollback to old scoring system (15/10-variable/0)...');

  const matchesSnapshot = await db.ref('matches').get();
  if (!matchesSnapshot.exists()) {
    log('error', 'No matches found in database');
    process.exit(1);
  }
  const matches = matchesSnapshot.val();

  const predictionsSnapshot = await db.ref('predictions').get();
  if (!predictionsSnapshot.exists()) {
    log('warn', 'No predictions found in database');
    process.exit(0);
  }
  const allPredictions = predictionsSnapshot.val();

  const updates = {};
  const userScores = {};
  let changedCount = 0;
  let totalCount = 0;

  for (const [uid, userPredictions] of Object.entries(allPredictions)) {
    let userTotal = 0;

    for (const [gameId, prediction] of Object.entries(userPredictions)) {
      const match = matches[gameId];
      if (!match || match.homeScore < 0 || match.awayScore < 0) {
        continue;
      }

      totalCount++;

      const oldPoints = calculateOldPoints(
        match.homeScore,
        match.awayScore,
        prediction.homePrediction,
        prediction.awayPrediction
      );

      if (prediction.points !== oldPoints) {
        updates[`predictions/${uid}/${gameId}/points`] = oldPoints;
        changedCount++;
        log('info', `User ${uid} | Game ${gameId}: ${prediction.points} → ${oldPoints}`);
      }

      userTotal += oldPoints;
    }

    userScores[uid] = userTotal;
  }

  // Apply prediction updates
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    log('info', `Updated ${Object.keys(updates).length} prediction points`);
  } else {
    log('info', 'No prediction points needed updating');
  }

  // Update user scores
  for (const [uid, score] of Object.entries(userScores)) {
    await db.ref(`users/${uid}/score`).set(score);
    log('info', `User ${uid}: score = ${score}`);
  }

  log('info', `\nRollback complete!`);
  log('info', `Total predictions processed: ${totalCount}`);
  log('info', `Predictions updated: ${changedCount}`);
  log('info', `Users updated: ${Object.keys(userScores).length}`);
  process.exit(0);
}

const db = initializeApp();
rollbackPoints(db).catch((err) => {
  log('error', `Rollback failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
