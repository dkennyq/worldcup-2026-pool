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

## Configuration

Edit `utils/migrate-config.json` to define users and predictions:

```json
{
  "users": [
    {
      "uid": "fU4jaikpckRvUm7hBEoQJiv5PuY2",
      "email": "josefa.fandinho@gmail.com",
      "displayName": "Josefa F.",
      "userName": "josefa.fandinho",
      "photoURL": "https://i.imgur.com/Z9TguNe.png",
      "admin": true
    }
  ],
  "predictions": {
    "fU4jaikpckRvUm7hBEoQJiv5PuY2": {
      "1": { "homePrediction": 2, "awayPrediction": 0 },
      "2": { "homePrediction": 1, "awayPrediction": 1 }
    }
  }
}
```

### User Fields
| Field | Required | Description |
|-------|----------|-------------|
| `uid` | Yes | 28-character Firebase-style UID |
| `email` | Yes | User email (must be unique in Auth) |
| `displayName` | Yes | Name shown in UI |
| `userName` | Yes | Unique username (dots allowed) |
| `photoURL` | No | Profile picture URL |
| `admin` | No | Set to `true` for admin privileges |

### Generating a UID
If you need to generate a new UID, run:
```bash
node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';let u='';for(let i=0;i<28;i++)u+=c[Math.floor(Math.random()*62)];console.log(u);"
```

## Usage

### Migrate Users Only
```bash
node utils/migrate.js --users
```

### Migrate Predictions Only
```bash
node utils/migrate.js --predictions
```

### Migrate Both (default)
```bash
node utils/migrate.js
```

### Recalculate Scores (after migrating predictions for played matches)
```bash
node utils/migrate.js --recalculate
```

### Combine operations
```bash
node utils/migrate.js --users --predictions --recalculate
```

## What the Script Does

### User Migration
1. **Creates/updates Firebase Auth user** with email, displayName, photoURL
2. **Creates user record** in `users/{uid}` with email, displayName, userName, photoURL, score: 0, admin
3. **Creates username index** in `usernames/{normalizedUsername}` -> `{uid}`
4. **Sets admin claims** (if `admin: true`)

### Prediction Migration
1. **Writes predictions** to `predictions/{uid}/{gameId}` with:
   - `homePrediction`, `awayPrediction`
   - `points: 0` (calculated later by Cloud Functions when match scores update)
   - `updatedAt: timestamp`

### Score Recalculation
1. **Reads all matches** and checks which have scores
2. **Calculates points** for each prediction based on actual match results
3. **Updates** `predictions/{uid}/{gameId}/points` and `users/{uid}/score`

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
    2:
      homePrediction: 1
      awayPrediction: 1
      points: 0
      updatedAt: 1718572800000
```

## Alternative: Import from CSV

If you have many users, you can convert a CSV to the JSON format:

```bash
# Example using csvtojson
npm install -g csvtojson
csvtojson users.csv > users.json
```

Then transform the JSON to match the `migrate-config.json` schema.

## Cleanup

After migration:
1. Remove `service-account.json` from your local machine
2. Consider disabling the service account in Firebase Console
3. Store the `migrate-config.json` as a backup (it does not contain secrets)

## Troubleshooting

### Error: `Service account key not found`
Make sure `service-account.json` is in the project root (same level as `package.json`).

### Error: `The user with the provided email already exists`
The script will update the existing user instead of creating a new one.

### Error: `Username is already taken`
The `usernames` index already has that normalized username. You must pick a unique username or delete the existing index first.
