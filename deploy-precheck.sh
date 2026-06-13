#!/usr/bin/env bash
set -euo pipefail

echo "== Spine Annotator deploy precheck =="

echo "\n[1/5] Checking Node/npm..."
node -v
npm -v

echo "\n[2/5] Installing dependencies..."
npm install

echo "\n[3/5] Building app..."
npm run build

echo "\n[4/5] Checking Wrangler login..."
if npx wrangler whoami; then
  echo "Wrangler login OK"
else
  echo "Wrangler is not logged in. Run: npx wrangler login"
fi

echo "\n[5/5] Checking wrangler.jsonc database_id..."
if grep -q "REPLACE_WITH_D1_DATABASE_ID" wrangler.jsonc; then
  echo "database_id is not set yet. Run: npx wrangler d1 create spine-annotator-production"
  echo "Then paste the database_id into wrangler.jsonc."
else
  echo "database_id looks set."
fi

echo "\nPrecheck done."
