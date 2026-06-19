/**
 * Fix Scores Script - Recalculate user scores from predictions
 * This fixes race conditions caused by concurrent updateUserScore triggers.
 *
 * Run: node utils/fix-scores.js
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

async function fixScores(db) {
  log('info', 'Starting score recalculation...');

  const usersSnap = await db.ref('users').get();
  if (!usersSnap.exists()) {
    log('error', 'No users found');
    process.exit(1);
  }
  const users = usersSnap.val();

  const predictionsSnap = await db.ref('predictions').get();
  if (!predictionsSnap.exists()) {
    log('error', 'No predictions found');
    process.exit(1);
  }
  const allPredictions = predictionsSnap.val();

  const updates = {};
  let fixedCount = 0;

  for (const [uid, userData] of Object.entries(users)) {
    const userPredictions = allPredictions[uid];
    if (!userPredictions) {
      log('warn', `User ${uid} has no predictions, setting score to 0`);
      updates[`users/${uid}/score`] = 0;
      fixedCount++;
      continue;
    }

    let correctScore = 0;
    for (const prediction of Object.values(userPredictions)) {
      correctScore += (prediction.points || 0);
    }

    const currentScore = userData.score || 0;
    if (currentScore !== correctScore) {
      log('info', `User ${uid} (${userData.userName || 'unknown'}): ${currentScore} → ${correctScore}`);
      updates[`users/${uid}/score`] = correctScore;
      fixedCount++;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    log('info', `Fixed ${Object.keys(updates).length} user scores`);
  } else {
    log('info', 'No scores needed fixing');
  }

  log('info', 'Done!');
  process.exit(0);
}

const db = initializeApp();
fixScores(db).catch(err => {
  log('error', err.message);
  console.error(err);
  process.exit(1);
});
