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
 *   node utils/migrate.js                              Migrate users + predictions from JSON/CSV
 *   node utils/migrate.js --users                      Migrate only users
 *   node utils/migrate.js --predictions                Migrate only predictions
 *   node utils/migrate.js --users --csv users.csv     Migrate users from CSV
 *   node utils/migrate.js --predictions --csv pred.csv Migrate predictions from CSV
 *   node utils/migrate.js --generate-predictions UID   Generate random predictions for UID
 *   node utils/migrate.js --generate-predictions all   Generate random predictions for all users
 *   node utils/migrate.js --recalculate                Recalculate scores for played matches
 *   node utils/migrate.js --list-matches               List all matches from Firebase
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

const CONFIG_PATH = path.join(__dirname, 'migrate-config.json');
const DEFAULT_USERS_CSV = path.join(__dirname, 'users-example.csv');
const DEFAULT_PREDICTIONS_CSV = path.join(__dirname, 'predictions-example.csv');

// ────────────────────────────────────────────────
// CSV PARSER
// ────────────────────────────────────────────────

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ? values[index].trim() : '';
    });
    rows.push(row);
  }

  return rows;
}

function loadUsersFromCSV(csvPath) {
  if (!fs.existsSync(csvPath)) {
    log('error', `CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(raw);

  return rows.map((row) => ({
    uid: row.uid,
    email: row.email,
    displayName: row.displayName,
    userName: row.userName,
    photoURL: row.photoURL || '',
    admin: row.admin === 'true' || row.admin === '1',
  }));
}

function loadPredictionsFromCSV(csvPath) {
  if (!fs.existsSync(csvPath)) {
    log('error', `CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(raw);

  const predictions = {};
  for (const row of rows) {
    const uid = row.uid;
    const gameId = row.gameId;
    if (!uid || !gameId) continue;

    if (!predictions[uid]) predictions[uid] = {};
    predictions[uid][gameId] = {
      homePrediction: parseInt(row.homePrediction, 10),
      awayPrediction: parseInt(row.awayPrediction, 10),
    };
  }

  return predictions;
}

// ────────────────────────────────────────────────
// CONFIG LOADER (JSON fallback)
// ────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { users: [], predictions: {} };
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

// ────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────────────

function normalizeUsername(userName) {
  return userName.toLowerCase().replace(/\./g, '');
}

function generateUid() {
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
// MATCHES: FETCH FROM FIREBASE
// ────────────────────────────────────────────────

async function fetchMatchesFromFirebase(db) {
  const matchesSnapshot = await db.ref('matches').get();
  if (!matchesSnapshot.exists()) {
    log('warn', 'No matches found in Firebase database');
    return {};
  }
  return matchesSnapshot.val();
}

async function listMatches(db) {
  const matches = await fetchMatchesFromFirebase(db);
  const gameIds = Object.keys(matches);

  log('info', `Found ${gameIds.length} matches in Firebase:`);
  console.log('\n┌───────┬─────────────────────────────┬──────────┬──────────┐');
  console.log('│ Game  │ Match                       │ Home     │ Away     │');
  console.log('├───────┼─────────────────────────────┼──────────┼──────────┤');

  for (const gameId of gameIds.sort((a, b) => parseInt(a) - parseInt(b))) {
    const match = matches[gameId];
    const home = match.homeName || match.home || '???';
    const away = match.awayName || match.away || '???';
    const homeScore = match.homeScore >= 0 ? match.homeScore : '-';
    const awayScore = match.awayScore >= 0 ? match.awayScore : '-';
    const result = match.homeScore >= 0 ? `${homeScore}-${awayScore}` : 'vs';
    const name = `${home} ${result} ${away}`.padEnd(27).substring(0, 27);
    console.log(`│ ${gameId.toString().padStart(3)}   │ ${name} │ ${home.substring(0, 8).padEnd(8)} │ ${away.substring(0, 8).padEnd(8)} │`);
  }
  console.log('└───────┴─────────────────────────────┴──────────┴──────────┘');
  console.log('');
  return matches;
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

async function migrateAllUsers(auth, db, usersToMigrate) {
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
  const predictionsData = {};
  const now = Date.now();

  for (const [gameId, pred] of Object.entries(predictions)) {
    predictionsData[`predictions/${uid}/${gameId}`] = {
      homePrediction: pred.homePrediction,
      awayPrediction: pred.awayPrediction,
      points: 0,
      updatedAt: now,
    };
  }

  // Use update() on the root to merge predictions without deleting existing ones
  await db.ref().update(predictionsData);
  log('info', `Migrated ${Object.keys(predictions).length} predictions for ${uid}`);
}

async function migrateAllPredictions(db, predictionsToMigrate) {
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
// GENERATE RANDOM PREDICTIONS
// ────────────────────────────────────────────────

async function generateRandomPredictions(db, uid, matches) {
  const predictions = {};
  const gameIds = Object.keys(matches);

  for (const gameId of gameIds) {
    const match = matches[gameId];
    // Only generate predictions for matches that haven't started yet
    if (match.timestamp * 1000 > Date.now()) {
      predictions[gameId] = {
        homePrediction: Math.floor(Math.random() * 4), // 0-3
        awayPrediction: Math.floor(Math.random() * 4),   // 0-3
      };
    }
  }

  return predictions;
}

async function generatePredictionsForAllUsers(db, matches) {
  const usersSnapshot = await db.ref('users').get();
  if (!usersSnapshot.exists()) {
    log('warn', 'No users found in database');
    return;
  }

  const users = usersSnapshot.val();
  const userIds = Object.keys(users);

  for (const uid of userIds) {
    const predictions = await generateRandomPredictions(db, uid, matches);
    if (Object.keys(predictions).length === 0) {
      log('info', `No future matches for ${uid}, skipping predictions`);
      continue;
    }

    await migratePredictions(db, uid, predictions);
    log('info', `Generated ${Object.keys(predictions).length} random predictions for ${uid} (${users[uid].userName})`);
  }
}

async function generatePredictionsForUser(db, uid, matches) {
  const userRef = db.ref(`users/${uid}`);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists()) {
    log('error', `User ${uid} not found in database`);
    return;
  }

  const predictions = await generateRandomPredictions(db, uid, matches);
  if (Object.keys(predictions).length === 0) {
    log('info', `No future matches for ${uid}, skipping predictions`);
    return;
  }

  await migratePredictions(db, uid, predictions);
  log('info', `Generated ${Object.keys(predictions).length} random predictions for ${uid}`);
}

// ────────────────────────────────────────────────
// SCORE RECALCULATION
// ────────────────────────────────────────────────

async function recalculateUserScores(db) {
  log('info', 'Recalculating user scores based on predictions...');

  const usersSnapshot = await db.ref('users').get();
  if (!usersSnapshot.exists()) {
    log('warn', 'No users found in database');
    return;
  }

  const users = usersSnapshot.val();
  const matches = await fetchMatchesFromFirebase(db);

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
        const points = calculatePoints(
          match.homeScore,
          match.awayScore,
          prediction.homePrediction,
          prediction.awayPrediction
        );
        totalScore += points;

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

// ────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const migrateUsersFlag = args.includes('--users') || args.length === 0;
  const migratePredictionsFlag = args.includes('--predictions') || args.length === 0;
  const recalculateFlag = args.includes('--recalculate');
  const listMatchesFlag = args.includes('--list-matches');
  const generatePredictionsFlag = args.includes('--generate-predictions');

  const usersCsvFlag = args.find((arg) => arg.startsWith('--users-csv='));
  const predictionsCsvFlag = args.find((arg) => arg.startsWith('--predictions-csv='));
  const usersCsvPath = usersCsvFlag ? usersCsvFlag.split('=')[1] : DEFAULT_USERS_CSV;
  const predictionsCsvPath = predictionsCsvFlag ? predictionsCsvFlag.split('=')[1] : DEFAULT_PREDICTIONS_CSV;

  const { auth, db } = initializeApp();

  // List matches from Firebase
  if (listMatchesFlag) {
    await listMatches(db);
    process.exit(0);
  }

  // Generate predictions for a user or all users
  if (generatePredictionsFlag) {
    const targetIndex = args.indexOf('--generate-predictions') + 1;
    const target = args[targetIndex];
    const matches = await fetchMatchesFromFirebase(db);

    if (!target || target === 'all') {
      await generatePredictionsForAllUsers(db, matches);
    } else {
      await generatePredictionsForUser(db, target, matches);
    }
    process.exit(0);
  }

  // Load users from CSV or JSON
  let usersToMigrate = [];
  if (args.some((arg) => arg.startsWith('--users-csv='))) {
    usersToMigrate = loadUsersFromCSV(usersCsvPath);
  } else if (migrateUsersFlag) {
    const config = loadConfig();
    usersToMigrate = config.users || [];
  }

  // Load predictions from CSV or JSON
  let predictionsToMigrate = {};
  if (args.some((arg) => arg.startsWith('--predictions-csv='))) {
    predictionsToMigrate = loadPredictionsFromCSV(predictionsCsvPath);
  } else if (migratePredictionsFlag) {
    const config = loadConfig();
    predictionsToMigrate = config.predictions || {};
  }

  // Migrate users
  if (migrateUsersFlag && usersToMigrate.length > 0) {
    await migrateAllUsers(auth, db, usersToMigrate);
  }

  // Migrate predictions
  if (migratePredictionsFlag && Object.keys(predictionsToMigrate).length > 0) {
    await migrateAllPredictions(db, predictionsToMigrate);
  }

  // Recalculate scores
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
