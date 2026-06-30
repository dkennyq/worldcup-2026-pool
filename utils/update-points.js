/**
 * Update Points Script - Migrate to new scoring system (3k/2k/1k)
 *
 * Prerequisites:
 * 1. Place service-account.json in project root
 * 2. Run: node utils/update-points.js
 *
 * This script reads all predictions from the database, recalculates
 * points using the new scoring system, and updates them in place.
 * It also recalculates total user scores.
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

function isKnockoutRound(round, group) {
  return (group === null || group === undefined) && !!round;
}

function calculateNewPoints(homeScore, awayScore, homePrediction, awayPrediction, isKnockout) {
  if (homeScore < 0 || homePrediction === null || awayPrediction === null) {
    return 0;
  }

  // Exact score: always 3k
  if (homeScore === homePrediction && awayScore === awayPrediction) {
    return 3000;
  }

  const actualWinner = getWinner(homeScore, awayScore);
  const predictedWinner = getWinner(homePrediction, awayPrediction);

  if (actualWinner === predictedWinner) {
    // In knockout rounds, there are no draws - correct winner gets 1k
    if (isKnockout) {
      return 1000;
    }
    // Group stage: correct draw (not exact): 1k
    if (actualWinner === 'tied') {
      return 1000;
    }
    // Group stage: correct winner (not exact): 2k
    return 2000;
  }

  // Wrong result: 0
  return 0;
}

async function updatePoints(db) {
  log('info', 'Starting points migration to new system (3k/2k/1k)...');

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

      const isKnockout = isKnockoutRound(match.round, match.group);
      const newPoints = calculateNewPoints(
        match.homeScore,
        match.awayScore,
        prediction.homePrediction,
        prediction.awayPrediction,
        isKnockout
      );

      if (prediction.points !== newPoints) {
        updates[`predictions/${uid}/${gameId}/points`] = newPoints;
        changedCount++;
        log('info', `User ${uid} | Game ${gameId}: ${prediction.points} → ${newPoints}`);
      }

      userTotal += newPoints;
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

  log('info', `\nMigration complete!`);
  log('info', `Total predictions processed: ${totalCount}`);
  log('info', `Predictions updated: ${changedCount}`);
  log('info', `Users updated: ${Object.keys(userScores).length}`);
  process.exit(0);
}

const db = initializeApp();
updatePoints(db).catch((err) => {
  log('error', `Migration failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
