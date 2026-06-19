# Migration Process

## Overview

This directory contains scripts for migrating users and predictions into the Firebase Realtime Database for the World Cup 2026 Pool application.

## Architecture Decision

**Best option: One-time Node.js script using `firebase-admin` SDK**

Reasons:
- **Bypasses security rules**: Admin SDK has full read/write access to the database
- **One-time execution**: Perfect for bulk importing historical data
- **Creates Firebase Auth users**: Can fully recreate a user including authentication
- **Atomic operations**: Can create user + username index + predictions in a single run
- **Reversible**: Easy to delete and re-import if needed

## Prerequisites

1. Install the script dependency:
```bash
npm install firebase-admin
```

2. Download your Firebase service account key:
   - Go to [Firebase Console](https://console.firebase.google.com/) > Project Settings > Service Accounts
   - Click "Generate new private key"
   - Save the file as `service-account.json` in the **project root** (next to `package.json`)

   ⚠️ **IMPORTANT**: Add `service-account.json` to `.gitignore` immediately. Never commit this file.

## Files in this directory

| File | Purpose |
|------|---------|
| `migrate.js` | Main migration script |
| `migrate-config.json` | JSON configuration (users + predictions) |
| `users-example.csv` | Example CSV with users to import |
| `predictions-example.csv` | Example CSV with predictions per user |

## Working with Matches

Before creating predictions, you should know which matches exist in the database.

### List all matches from Firebase
```bash
node utils/migrate.js --list-matches
```

This prints a table showing all matches with their `gameId`, teams, and current scores. Use the `gameId` column when creating predictions.

## Migrating Users

### From CSV (Recommended for bulk import)

Create a CSV file following the format of `users-example.csv`:

```csv
uid,email,displayName,userName,photoURL,admin
fU4jaikpckRvUm7hBEoQJiv5PuY2,josefa.fandinho@gmail.com,Josefa F.,josefa.fandinho,https://i.imgur.com/Z9TguNe.png,true
```

**Columns:**
| Column | Required | Description |
|--------|----------|-------------|
| `uid` | Yes | 28-character Firebase-style UID (generate one if needed) |
| `email` | Yes | User email (must be unique) |
| `displayName` | Yes | Name shown in UI |
| `userName` | Yes | Unique username (dots allowed) |
| `photoURL` | No | Profile picture URL |
| `admin` | No | `true` or `false` |

**Generate a new UID:**
```bash
node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';let u='';for(let i=0;i<28;i++)u+=c[Math.floor(Math.random()*62)];console.log(u);"
```

**Migrate users from CSV:**
```bash
node utils/migrate.js --users --users-csv=utils/users-example.csv
```

### From JSON

Edit `migrate-config.json` and run:
```bash
node utils/migrate.js --users
```

## Migrating Predictions

### From CSV (Recommended for bulk import)

Create a CSV file following the format of `predictions-example.csv`:

```csv
uid,gameId,homePrediction,awayPrediction
fU4jaikpckRvUm7hBEoQJiv5PuY2,1,2,0
fU4jaikpckRvUm7hBEoQJiv5PuY2,2,1,1
```

**Columns:**
| Column | Description |
|--------|-------------|
| `uid` | User's UID (must exist in database) |
| `gameId` | Match game ID (see `node utils/migrate.js --list-matches`) |
| `homePrediction` | Predicted goals for home team |
| `awayPrediction` | Predicted goals for away team |

**Migrate predictions from CSV:**
```bash
node utils/migrate.js --predictions --predictions-csv=utils/predictions-example.csv
```

### From JSON

Edit `migrate-config.json` and run:
```bash
node utils/migrate.js --predictions
```

### Generate Random Predictions (for testing)

If you want to quickly generate random predictions for users based on actual matches in Firebase:

```bash
# For a single user
node utils/migrate.js --generate-predictions fU4jaikpckRvUm7hBEoQJiv5PuY2

# For all users in the database
node utils/migrate.js --generate-predictions all
```

This reads the `matches` object from Firebase and creates random predictions (0-3 goals) for matches that haven't started yet.

## Combined Operations

```bash
# Migrate users + predictions from CSV
node utils/migrate.js --users --predictions --users-csv=utils/users-example.csv --predictions-csv=utils/predictions-example.csv

# Migrate everything + recalculate scores for played matches
node utils/migrate.js --users --predictions --recalculate --users-csv=utils/users-example.csv --predictions-csv=utils/predictions-example.csv

# Only recalculate scores
node utils/migrate.js --recalculate
```

## Database Structure Created

```
users/
  fU4jaikpckRvUm7hBEoQJiv5PuY2/
    email: "josefa.fandinho@gmail.com"
    displayName: "Josefa F."
    userName: "josefa.fandinho"
    photoURL: "https://i.imgur.com/Z9TguNe.png"
    score: 0
    admin: true

usernames/
  josefafandinho: "fU4jaikpckRvUm7hBEoQJiv5PuY2"

predictions/
  fU4jaikpckRvUm7hBEoQJiv5PuY2/
    1:
      homePrediction: 2
      awayPrediction: 0
      points: 0
      updatedAt: 1718572800000
```

## Cleanup

After migration:
1. Remove `service-account.json` from your local machine
2. Consider disabling the service account in Firebase Console
3. Store the CSV/JSON files as backups (they do not contain secrets)

## Troubleshooting

### Error: `Service account key not found`
Make sure `service-account.json` is in the project root (same level as `package.json`).

### Error: `The user with the provided email already exists`
The script will update the existing user instead of creating a new one.

### Error: `Username is already taken`
The `usernames` index already has that normalized username. Pick a unique username or delete the existing index first.

### Error: `Match not found for gameId X`
Make sure the `gameId` in your predictions CSV matches the actual game IDs in Firebase. Run `node utils/migrate.js --list-matches` to verify.
