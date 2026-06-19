/**
 * Diagnostic script: Check predictions for a specific user
 * Run: node utils/diagnose-user.js <uid>
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
const DATABASE_URL = 'https://arenavault-d9f7f-default-rtdb.firebaseio.com';

const uid = process.argv[2] || 'fU4jaikpckRvUm7hBEoQJiv5PuY2';

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ service-account.json not found');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  databaseURL: DATABASE_URL,
});

const db = admin.database();

async function diagnose() {
  console.log(`\n🔍 Diagnosing user: ${uid}\n`);

  // 1. Check user score
  const userSnap = await db.ref(`users/${uid}`).get();
  if (userSnap.exists()) {
    const user = userSnap.val();
    console.log(`📊 User score in DB: ${user.score}`);
    console.log(`👤 Name: ${user.displayName} (@${user.userName})`);
  }

  // 2. Check predictions
  const predSnap = await db.ref(`predictions/${uid}`).get();
  if (!predSnap.exists()) {
    console.log('❌ No predictions found');
    process.exit(0);
  }

  const predictions = predSnap.val();
  const gameIds = Object.keys(predictions).sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`\n📋 Predictions (${gameIds.length} total):\n`);
  console.log('Game | Home | Away | Points | Match');
  console.log('-----|------|------|--------|------');

  // 3. Check for duplicates
  const seen = new Set();
  const duplicates = [];

  let manualSum = 0;

  // 4. Fetch matches for context
  const matchesSnap = await db.ref('matches').get();
  const matches = matchesSnap.exists() ? matchesSnap.val() : {};

  for (const gameId of gameIds) {
    const p = predictions[gameId];
    const match = matches[gameId];
    const matchStr = match ? `${match.homeName || match.home} ${match.homeScore}-${match.awayScore} ${match.awayName || match.away}` : 'N/A';

    console.log(`${gameId.toString().padStart(4)} | ${p.homePrediction.toString().padStart(4)} | ${p.awayPrediction.toString().padStart(4)} | ${p.points.toString().padStart(6)} | ${matchStr}`);

    manualSum += p.points;

    if (seen.has(gameId)) {
      duplicates.push(gameId);
    }
    seen.add(gameId);
  }

  console.log(`\n🧮 Manual sum of points: ${manualSum}`);
  console.log(`📊 DB score: ${userSnap.val()?.score || 'N/A'}`);

  if (duplicates.length > 0) {
    console.log(`\n⚠️ Duplicate gameIds found: ${duplicates.join(', ')}`);
  } else {
    console.log(`\n✅ No duplicate gameIds found`);
  }

  // 5. Check if any points are not 0, 1000, 2000, or 3000
  const invalid = gameIds.filter(gid => {
    const pts = predictions[gid].points;
    return pts !== 0 && pts !== 1000 && pts !== 2000 && pts !== 3000;
  });

  if (invalid.length > 0) {
    console.log(`\n⚠️ Invalid point values found in games: ${invalid.join(', ')}`);
    for (const gid of invalid) {
      console.log(`  Game ${gid}: ${predictions[gid].points} points`);
    }
  } else {
    console.log(`\n✅ All point values are valid (0, 1000, 2000, 3000)`);
  }

  process.exit(0);
}

diagnose().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
