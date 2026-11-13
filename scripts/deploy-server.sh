#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-193.123.187.241}"
SERVER_USER="${SERVER_USER:-ubuntu}"
KEY_PATH="${KEY_PATH:-../ssh-key-2025-11-14.key}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/faizan-e-madina-backend}"

echo "========================================"
echo "🕌 FMMS Strapi Backend Deployment Pipeline"
echo "========================================"

echo "[1/5] Checking branch..."
CURRENT_BRANCH="$(git symbolic-ref --short HEAD)"
echo "Branch: $CURRENT_BRANCH"

echo "[2/5] Running TypeScript check..."
npm run typecheck

echo "[3/5] Building Strapi locally..."
npm run build

if [[ -n $(git status --porcelain dist/) ]]; then
  git add dist/
  git commit -m "chore(release): compile production artifacts [FMMS]"
  git push origin "$CURRENT_BRANCH"
fi

echo "[4/5] Executing remote deployment via SSH..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" \
  "cd $REMOTE_DIR && git pull origin main && npm install --omit=dev && pm2 reload ecosystem.config.js --update-env && pm2 status"

echo "[5/5] Checking health..."
sleep 5
curl -s -f https://portal.faizanemadinasouthend.co.uk/_health && echo "✅ API Healthy!"
