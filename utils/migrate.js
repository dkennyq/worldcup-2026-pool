/**
 * User & Prediction Migration Script for World Cup 2026 Pool
 * 
 * This script uses firebase-admin SDK to bypass security rules and
 * directly create/update users and their predictions in the database.
 * 
 * Prerequisites:
 * 1. Download your Firebase service account key from:
 *    Firebase Console > Project Settings > Service Accounts > Generate new private key
 * 2. Save it as `service-account.json` in the project root (DO NOT COMMIT THIS FILE)
 * 3. Install dependencies: npm install firebase-admin
 * 
 * Usage:
 *   node utils/migrate.js --users      Migrate only users
 *   node utils/migrate.js --predictions  Migrate only predictions
 *   node utils/migrate.js              Migrate both
 * 
 * Best practice: This is a one-time process. After migration, remove
 * the service account key and disable this script.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
const DATABASE_URL = 'https://arenavault-d9f7f-default-rtdb.firebaseio.com';

// ────────────────────────────────────────────────
// USERS TO MIGRATE
// ────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'migrate-config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log('error', `Configuration file not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

const config = loadConfig();
const usersToMigrate = config.users || [];
const predictionsToMigrate = config.predictions || {};

// ────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────────────

function normalizeUsername(userName) {
  return userName.toLowerCase().replace(/\./g, '');
}

function generateUid() {
  // Generate a Firebase-style UID (28 chars, alphanumeric)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let uid = '';
  for (let i = 0; i < 28; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid;
}

function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✅';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

// ────────────────────────────────────────────────
// INITIALIZATION
// ────────────────────────────────────────────────

function initializeApp() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`
❌ Service account key not found!

Please download your Firebase service account key:
  1. Go to Firebase Console > Project Settings > Service Accounts
  2. Click "Generate new private key"
  3. Save the file as "service-account.json" in the project root

WARNING: Never commit this file to version control!
    `);
    process.exit(1);
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });

  log('info', 'Firebase Admin SDK initialized successfully');
  return {
    auth: admin.auth(),
    db: admin.database(),
  };
}

// ────────────────────────────────────────────────
// USER MIGRATION
// ────────────────────────────────────────────────

async function migrateUser(auth, db, userData) {
  const { uid, email, displayName, userName, photoURL, admin: isAdmin } = userData;
  const normalizedUsername = normalizeUsername(userName);

  try {
    // Step 1: Create or update user in Firebase Authentication
    try {
      await auth.getUser(uid);
      log('info', `User ${email} already exists in Auth, updating...`);
      await auth.updateUser(uid, {
        email,
        displayName,
        photoURL,
      });
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        await auth.createUser({
          uid,
          email,
          displayName,
          photoURL,
          emailVerified: true,
        });
        log('info', `Created user ${email} in Firebase Auth with UID: ${uid}`);
      } else {
        throw err;
      }
    }

    // Step 2: Save user data to Realtime Database
    const userRef = db.ref(`users/${uid}`);
    const userDbData = {
      email,
      displayName,
      userName,
      photoURL,
      score: 0,
      admin: isAdmin || false,
    };
    await userRef.set(userDbData);
    log('info', `Saved user data to database: users/${uid}`);

    // Step 3: Create username index
    const usernameRef = db.ref(`usernames/${normalizedUsername}`);
    await usernameRef.set(uid);
    log('info', `Created username index: usernames/${normalizedUsername} -> ${uid}`);

    // Step 4: Set custom claims if admin
    if (isAdmin) {
      await auth.setCustomUserClaims(uid, { admin: true });
      log('info', `Set admin claims for ${email}`);
    }

    return { success: true, uid };
  } catch (error) {
    log('error', `Failed to migrate user ${email}: ${error.message}`);
    return { success: false, uid, error: error.message };
  }
}

async function migrateAllUsers(auth, db) {
  log('info', `Starting migration of ${usersToMigrate.length} user(s)...`);
  const results = [];

  for (const user of usersToMigrate) {
    const result = await migrateUser(auth, db, user);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  log('info', `\nUser migration complete: ${successCount} success, ${failCount} failed`);
  return results;
}

// ────────────────────────────────────────────────
// PREDICTION MIGRATION
// ────────────────────────────────────────────────

async function migratePredictions(db, uid, predictions) {
  const predictionsRef = db.ref(`predictions/${uid}`);
  const predictionsData = {};
  const now = Date.now();

  for (const [gameId, pred] of Object.entries(predictions)) {
    predictionsData[gameId] = {
      homePrediction: pred.homePrediction,
      awayPrediction: pred.awayPrediction,
      points: 0, // Points will be calculated by Cloud Functions when match scores update
      updatedAt: now,
    };
  }

  await predictionsRef.set(predictionsData);
  log('info', `Migrated ${Object.keys(predictions).length} predictions for ${uid}`);
}

async function migrateAllPredictions(db) {
  const userIds = Object.keys(predictionsToMigrate);
  log('info', `Starting migration of predictions for ${userIds.length} user(s)...`);

  for (const uid of userIds) {
    const predictions = predictionsToMigrate[uid];
    const predictionCount = Object.keys(predictions).length;

    try {
      // Check if user exists first
      const userRef = db.ref(`users/${uid}`);
      const userSnapshot = await userRef.get();
      if (!userSnapshot.exists()) {
        log('warn', `User ${uid} not found in database. Skipping predictions.`);
        continue;
      }

      await migratePredictions(db, uid, predictions);
      log('info', `✓ Migrated ${predictionCount} predictions for ${uid}`);
    } catch (error) {
      log('error', `Failed to migrate predictions for ${uid}: ${error.message}`);
    }
  }

  log('info', 'Prediction migration complete');
}

// ────────────────────────────────────────────────
// SCORE RECALCULATION (for played matches)
// ────────────────────────────────────────────────

async function recalculateUserScores(db) {
  log('info', 'Recalculating user scores based on predictions...');

  const usersSnapshot = await db.ref('users').get();
  if (!usersSnapshot.exists()) {
    log('warn', 'No users found in database');
    return;
  }

  const users = usersSnapshot.val();
  const matchesSnapshot = await db.ref('matches').get();
  const matches = matchesSnapshot.exists() ? matchesSnapshot.val() : {};

  for (const [uid, userData] of Object.entries(users)) {
    const predictionsSnapshot = await db.ref(`predictions/${uid}`).get();
    if (!predictionsSnapshot.exists()) {
      log('info', `User ${uid} has no predictions, score: 0`);
      await db.ref(`users/${uid}/score`).set(0);
      continue;
    }

    const predictions = predictionsSnapshot.val();
    let totalScore = 0;

    for (const [gameId, prediction] of Object.entries(predictions)) {
      const match = matches[gameId];
      if (match && match.homeScore >= 0 && match.awayScore >= 0) {
        // Match has been played, calculate points
        const points = calculatePoints(
          match.homeScore,
          match.awayScore,
          prediction.homePrediction,
          prediction.awayPrediction
        );
        totalScore += points;

        // Update prediction points if different
        if (prediction.points !== points) {
          await db.ref(`predictions/${uid}/${gameId}/points`).set(points);
        }
      }
    }

    await db.ref(`users/${uid}/score`).set(totalScore);
    log('info', `User ${uid} (${userData.userName}): score = ${totalScore}`);
  }
}

function getWinner(home, away) {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'tied';
}

function calculatePoints(homeScore, awayScore, homePrediction, awayPrediction) {
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

// ────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const migrateUsersFlag = args.includes('--users') || args.length === 0;
  const migratePredictionsFlag = args.includes('--predictions') || args.length === 0;
  const recalculateFlag = args.includes('--recalculate');

  const { auth, db } = initializeApp();

  if (migrateUsersFlag) {
    await migrateAllUsers(auth, db);
  }

  if (migratePredictionsFlag) {
    await migrateAllPredictions(db);
  }

  if (recalculateFlag) {
    await recalculateUserScores(db);
  }

  log('info', 'Migration process finished!');
  process.exit(0);
}

main().catch((err) => {
  log('error', `Migration failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
