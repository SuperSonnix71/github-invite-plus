# Docker Quick Start

## Deploy in 3 Steps

1. **Configure environment:**
   ```bash
   cd docker
   cp .env.example .env
   nano .env  # Edit with your values
   ```

2. **Deploy:**
   ```bash
   ./deploy.sh
   ```

3. **Access:**
   - Server: http://your-ip:8787
   - Health check: http://your-ip:8787/api/health

## Generate Required Secrets

```bash
# TOKEN_ENC_KEY_BASE64
openssl rand -base64 32

# SESSION_SECRET
openssl rand -base64 32

# MEILI_MASTER_KEY
openssl rand -base64 32
```

## Common Commands

```bash
# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Stop services
docker-compose -f docker/docker-compose.yml down

# Restart
cd docker && ./deploy.sh
```

## Remote Access

The solution is accessible from any network:
- **Local network**: http://<local-ip>:8787
- **Remote clients**: http://<public-ip>:8787

Open firewall ports if needed:
```bash
sudo ufw allow 8787/tcp
sudo ufw allow 7700/tcp
```

See `docker/README.md` for full documentation.
