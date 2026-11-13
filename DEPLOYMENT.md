# 🚀 Faizane Madina Masjid Southend | Strapi Backend Deployment & Operations Runbook

**Server Host:** `193.123.187.241` (`portal.faizanemadinasouthend.co.uk`)  
**User:** `ubuntu`  
**Application Directory:** `/home/ubuntu/faizan-e-madina-backend`  
**Process Manager:** PM2 (Application name: `strapi`)  
**Database:** PostgreSQL  
**Media Provider:** Cloudinary  
**Local Key File:** `ssh-key-2025-11-14.key`

---

## 1. Why Strapi Requires Local / CI Compilation

Strapi v5 Admin Panel compilation (`strapi build`) is a heavy Webpack/Vite build that consumes **1.5 GB – 2.5 GB of RAM**. Running `npm run build` directly on low-resource cloud VPS instances frequently triggers the Linux kernel Out-Of-Memory (OOM) killer, terminating the Strapi process and bringing down the live API.

**Standard Architecture:**
1. Code is built locally or inside a GitHub Actions runner with adequate memory.
2. The generated `dist/` build folder is committed and pushed to git.
3. The remote VPS only executes lightweight commands: `git pull`, `npm install --omit=dev`, and `pm2 reload`.

---

## 2. Deployment Methods

### Option A: Local Automated Deploy Script (Recommended)
Run the automated deployment script from the project root:

```powershell
# Windows PowerShell
npm run deploy:server
```

Or directly:
```powershell
.\scripts\deploy-server.ps1
```

On macOS / Linux:
```bash
./scripts/deploy-server.sh
```

**What this script does:**
1. Verifies you are on `main` and working tree is clean.
2. Runs TypeScript typecheck (`npm run typecheck`).
3. Compiles production Strapi build locally (`npm run build`).
4. Commits `dist/` artifacts and pushes to GitHub.
5. Connects via SSH using `ssh-key-2025-11-14.key` to `ubuntu@193.123.187.241`.
6. Executes remote pull, production dependency install, zero-downtime PM2 reload, and health check verification.

---

### Option B: Automated GitHub Actions Continuous Deployment
Upon merging any PR into `main`, `.github/workflows/deploy.yml` can deploy automatically if repository secrets are configured:
- `SERVER_SSH_KEY`: Private key contents of `ssh-key-2025-11-14.key`.
- `SERVER_HOST`: `193.123.187.241`
- `SERVER_USER`: `ubuntu`

---

### Option C: Manual SSH Deployment Runbook
If manual intervention is needed:

1. **Connect to Server:**
   ```bash
   ssh -i /path/to/ssh-key-2025-11-14.key ubuntu@193.123.187.241
   ```

2. **Navigate to App Directory:**
   ```bash
   cd /home/ubuntu/faizan-e-madina-backend
   ```

3. **Pull Changes & Update Dependencies:**
   ```bash
   git pull origin main
   npm install --omit=dev
   ```

4. **Reload Strapi via PM2:**
   ```bash
   pm2 reload ecosystem.config.js --update-env
   ```

5. **Verify Process Status:**
   ```bash
   pm2 status
   pm2 logs strapi --lines 50
   ```

6. **Verify Live Health Check:**
   ```bash
   curl -i https://portal.faizanemadinasouthend.co.uk/_health
   ```

---

## 3. Operations & Maintenance

### PM2 Process Control
```bash
pm2 status                  # View status of running processes
pm2 restart strapi          # Hard restart of Strapi
pm2 reload strapi           # Zero-downtime reload
pm2 stop strapi             # Stop Strapi
pm2 logs strapi             # Stream live console logs
pm2 monit                   # Real-time CPU & memory dashboard
```

### PostgreSQL Database Backup & Restore
```bash
# Create timestamped database backup
pg_dump -U strapi -d strapi -F c -b -v -f ~/backups/strapi_$(date +%Y%m%d_%H%M%S).dump

# Restore database from backup
pg_restore -U strapi -d strapi -v ~/backups/strapi_YYYYMMDD_HHMMSS.dump
```

### SSL Certificate Renewal (Certbot)
```bash
sudo certbot renew --dry-run
sudo systemctl reload nginx
```

---

## 4. Rollback Procedure
If a bad deploy occurs:
1. Revert git commit locally or on server:
   ```bash
   git reset --hard HEAD~1
   ```
2. Reload PM2:
   ```bash
   pm2 reload ecosystem.config.js --update-env
   ```
3. Verify recovery via `pm2 logs strapi` and `curl https://portal.faizanemadinasouthend.co.uk/_health`.
