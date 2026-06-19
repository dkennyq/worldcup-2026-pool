const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'user-predictions-to-migrate.txt');
const outputFile = path.join(__dirname, 'predictions-to-migrate.csv');

const lines = fs.readFileSync(inputFile, 'utf-8').split(/\r?\n/);

// Manual user map from the first 9 lines
const users = {
  'Kenny': 'WGk3HHsJdyNjqHH8YVKfJPahsLU2',
  'Jf': 'fU4jaikpckRvUm7hBEoQJiv5PuY2',
  'Ian': 'cmAnNbw1DDfClUdoiTlNzmqhOvEZ',
  'Kai': '7TagHik7YfRrGvTNEbCeXbjQMQv0',
  'Bj': '4cFSVaP5pu9IeM3avbqxIWQlnYF2',
  'Emer': 'QLtMhUlXlwTOckgLWqpN5eKs5fze',
  'Alejo': 'kv9i2x25GWv6GxoDts0NpK6zeqCj',
  'Raul': 'fTc4dfslPGwslvnp440kCxiiCqqx',
  'Raúl': 'fTc4dfslPGwslvnp440kCxiiCqqx',
};

// Match mapping from Firebase (gameId -> home team normalized)
const matchTeams = {
  '3': 'Canada',
  '4': 'USA',
  '5': 'Qatar',
  '6': 'Brazil',
  '7': 'Haiti',
  '8': 'Australia',
  '9': 'Germany',
  '10': 'Netherlands',
  '11': 'Côte d\'Ivoire',
  '12': 'Sweden',
  '13': 'Spain',
  '14': 'Belgium',
  '15': 'Saudi Arabia',
  '16': 'IR Iran',
};

function normalizeTeamName(name) {
  return name.toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]/g, '');
}

function getWinnerTeam(winnerCode, homeTeam) {
  const code = winnerCode.toLowerCase();
  const home = normalizeTeamName(homeTeam);
  
  // Mapping of winner codes to normalized names
  const codeMap = {
    'can': 'canada',
    'usa': 'usa',
    'qat': 'qatar',
    'bra': 'brazil',
    'hai': 'haiti',
    'aus': 'australia',
    'ale': 'germany',
    'jap': 'japan',
    'cos': 'cotedivoire',
    'sue': 'sweden',
    'esp': 'spain',
    'bel': 'belgium',
    'uru': 'uruguay',
    'ira': 'iran',
    'nzl': 'newzealand',
    'par': 'paraguay',
    'sui': 'switzerland',
    'mar': 'morocco',
    'esc': 'scotland',
    'tur': 'turkey',
    'cur': 'curacao',
    'ned': 'netherlands',
    'ecu': 'ecuador',
    'tun': 'tunisia',
    'egi': 'egypt',
    'cab': 'caboverde',
    'sau': 'saudiarabia',
    'def': 'iran', // default for Iran
  };
  
  const winnerName = codeMap[code] || code;
  return winnerName === home;
}

// Parse predictions
const predictions = [];
let currentMatchId = null;
let currentHome = null;

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('Home') || trimmed.startsWith('Example') || trimmed.startsWith('the country') || trimmed.startsWith('users')) continue;

  // Match line: "Canadá 1 - Bosnia 1 (3)" or "Qatar 1- Suiza 1 (5)" or "Iran 2 - new zelan 2 (def) (16)"
  const matchLine = trimmed.match(/^(.+?)\s+(\d+)\s*-\s+(.+?)\s+(\d+)\s*(?:\(\w+\))?\s*\((\d+)\)/);
  if (matchLine) {
    currentMatchId = matchLine[5];
    // Home team name is everything before the last number on the left
    const homePart = trimmed.split('-')[0].trim();
    const homeMatch = homePart.match(/^(.+?)\s+\d+$/);
    currentHome = homeMatch ? homeMatch[1].trim() : homePart;
    
    // Use known team from Firebase if available
    if (matchTeams[currentMatchId]) {
      currentHome = matchTeams[currentMatchId];
    }
    
    console.log(`Match ${currentMatchId}: ${currentHome}`);
    continue;
  }

  // Prediction line: "Bj 2 - 1 (can)" or "Alejo 2-0 (can)" or "Jf 1-1" (no winner)
  // Support names with accents (Raúl) and extra spaces
  const predMatch = trimmed.match(/^([\wÀ-ÿ]+)\s+(\d+)\s*-\s*(\d+)(?:\s*\(([\wÀ-ÿ]+)\))?/);
  if (predMatch && currentMatchId) {
    const user = predMatch[1];
    const firstNum = parseInt(predMatch[2], 10);
    const secondNum = parseInt(predMatch[3], 10);
    const winner = predMatch[4]; // might be undefined

    let homePrediction, awayPrediction;
    
    if (winner) {
      const isHomeWinner = getWinnerTeam(winner, currentHome);
      if (isHomeWinner) {
        homePrediction = firstNum;
        awayPrediction = secondNum;
      } else {
        homePrediction = secondNum;
        awayPrediction = firstNum;
      }
    } else {
      // No winner specified, assume first number is homePrediction
      homePrediction = firstNum;
      awayPrediction = secondNum;
    }

    const uid = users[user];
    if (!uid) {
      console.warn(`Unknown user: ${user}`);
      continue;
    }

    predictions.push({
      uid,
      gameId: currentMatchId,
      homePrediction,
      awayPrediction,
    });
  }
}

// Write CSV
const csvLines = ['uid,gameId,homePrediction,awayPrediction'];
for (const p of predictions) {
  csvLines.push(`${p.uid},${p.gameId},${p.homePrediction},${p.awayPrediction}`);
}

fs.writeFileSync(outputFile, csvLines.join('\n') + '\n');
console.log(`\n✅ Generated ${predictions.length} predictions`);
console.log(`Output written to: ${outputFile}`);

// Show first 10 predictions
console.log('\nFirst 10 predictions:');
for (const p of predictions.slice(0, 10)) {
  const userName = Object.keys(users).find(k => users[k] === p.uid);
  console.log(`  ${userName} (${p.uid}) | Game ${p.gameId} | Home: ${p.homePrediction} | Away: ${p.awayPrediction}`);
}

// Show predictions by user
console.log('\nPredictions by user:');
const byUser = {};
for (const p of predictions) {
  if (!byUser[p.uid]) byUser[p.uid] = 0;
  byUser[p.uid]++;
}
for (const [uid, count] of Object.entries(byUser)) {
  const userName = Object.keys(users).find(k => users[k] === uid);
  console.log(`  ${userName || uid}: ${count} predictions`);
}
