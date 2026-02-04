# GitHub Invite Plus - Docker Deployment

Complete Docker solution for deploying GitHub Invite Plus with all dependencies.

## Architecture

- **Server**: Express.js backend (Node.js 20 Alpine)
- **Meilisearch**: Search engine for code indexing
- **Volumes**: Persistent data for database and search index
- **Network**: Internal bridge network for service communication

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB RAM available
- Ports 8787 and 7700 available

## Quick Start

### 1. Configure Environment

```bash
cd docker
cp .env.example .env
nano .env
```

**Required Configuration:**
- `BASE_URL`: Your server's public URL (e.g., `http://your-ip:8787`)
- `GITHUB_APP_CLIENT_ID`: From your GitHub App
- `GITHUB_APP_CLIENT_SECRET`: From your GitHub App
- `TOKEN_ENC_KEY_BASE64`: Generate with `openssl rand -base64 32`
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`
- `MEILI_MASTER_KEY`: Generate with `openssl rand -base64 32`
- `EXTENSION_REDIRECT_URI`: Your Chrome extension redirect URI

### 2. Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. ✓ Validate environment configuration
2. ✓ Stop and remove existing containers
3. ✓ Clean up old images
4. ✓ Build new images
5. ✓ Start all services
6. ✓ Wait for health checks
7. ✓ Display status and access URLs

### 3. Verify Deployment

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Test health endpoint
curl http://localhost:8787/api/health
```

## Remote Access

The services are configured to accept connections from any network interface (0.0.0.0):

### Local Network Access
```
http://<your-local-ip>:8787
```

### Remote/Public Access
```
http://<your-public-ip>:8787
```

### Firewall Configuration

If you have a firewall, allow these ports:

```bash
# UFW (Ubuntu)
sudo ufw allow 8787/tcp
sudo ufw allow 7700/tcp

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=8787/tcp
sudo firewall-cmd --permanent --add-port=7700/tcp
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 8787 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 7700 -j ACCEPT
```

### Production Reverse Proxy (Recommended)

For production, use nginx or traefik with SSL:

**Nginx Example:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Management Commands

### View Logs
```bash
# All services
docker-compose logs -f

# Server only
docker logs -f gip-server

# Meilisearch only
docker logs -f gip-meilisearch
```

### Stop Services
```bash
docker-compose down
```

### Restart Services
```bash
docker-compose restart

# Restart specific service
docker-compose restart server
```

### Update Application
```bash
# Pull latest code
cd ..
git pull

# Redeploy
cd docker
./deploy.sh
```

### Backup Data
```bash
# Backup volumes
docker run --rm -v docker_server_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/server-data-$(date +%Y%m%d).tar.gz -C /data .

docker run --rm -v docker_meilisearch_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/meili-data-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore Data
```bash
# Restore server data
docker run --rm -v docker_server_data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/server-data-YYYYMMDD.tar.gz -C /data

# Restore meilisearch data
docker run --rm -v docker_meilisearch_data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/meili-data-YYYYMMDD.tar.gz -C /data
```

## Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose logs

# Check resource usage
docker stats

# Verify ports are available
netstat -tulpn | grep -E '8787|7700'
```

### Database Locked Error

```bash
# Stop services
docker-compose down

# Remove database lock
docker run --rm -v docker_server_data:/data alpine rm -f /data/gip.sqlite-shm /data/gip.sqlite-wal

# Restart
./deploy.sh
```

### Meilisearch Not Responding

```bash
# Check Meilisearch logs
docker logs gip-meilisearch

# Verify master key is set
docker exec gip-meilisearch env | grep MEILI_MASTER_KEY

# Restart Meilisearch
docker-compose restart meilisearch
```

### Cannot Connect Remotely

1. Verify firewall rules allow ports 8787 and 7700
2. Check if services are bound to 0.0.0.0:
   ```bash
   docker-compose ps
   netstat -tlnp | grep -E '8787|7700'
   ```
3. Ensure `BASE_URL` in `.env` uses public IP or domain
4. Check router/NAT port forwarding if behind NAT

## Performance Tuning

Edit `.env` to adjust:

```bash
# Increase concurrent indexing (more CPU/memory)
INDEX_CONCURRENCY=12

# Reduce file limits for smaller repos
MAX_INDEX_FILES_PER_BRANCH=10000

# Adjust polling frequency (seconds)
INVITE_POLL_INTERVAL_SECONDS=300

# Increase rate limits
API_RPM=480
```

## Security Best Practices

1. **Use Strong Secrets**: Generate all keys with `openssl rand -base64 32`
2. **Enable HTTPS**: Use reverse proxy with Let's Encrypt
3. **Restrict CORS**: Set `CORS_ORIGINS` to specific domains, not `*`
4. **Firewall**: Only expose required ports
5. **Regular Updates**: Keep Docker images and base system updated
6. **Monitor Logs**: Set up log aggregation and alerting
7. **Backup Data**: Automate daily backups of volumes

## Environment Variables Reference

| Variable                       | Required | Default | Description                   |
| ------------------------------ | -------- | ------- | ----------------------------- |
| `BASE_URL`                     | Yes      | -       | Public URL of the server      |
| `GITHUB_APP_CLIENT_ID`         | Yes      | -       | GitHub OAuth app client ID    |
| `GITHUB_APP_CLIENT_SECRET`     | Yes      | -       | GitHub OAuth app secret       |
| `TOKEN_ENC_KEY_BASE64`         | Yes      | -       | Encryption key for tokens     |
| `SESSION_SECRET`               | Yes      | -       | Express session secret        |
| `MEILI_MASTER_KEY`             | Yes      | -       | Meilisearch master key        |
| `EXTENSION_REDIRECT_URI`       | Yes      | -       | Chrome extension redirect URI |
| `CORS_ORIGINS`                 | Yes      | -       | Allowed CORS origins          |
| `WEBHOOK_SECRET`               | No       | -       | GitHub webhook secret         |
| `COOKIE_DOMAIN`                | No       | -       | Cookie domain override        |
| `INVITE_POLL_INTERVAL_SECONDS` | No       | 180     | Invite polling frequency      |
| `MAX_BLOB_BYTES`               | No       | 512000  | Maximum file size to index    |
| `MAX_INDEX_FILES_PER_BRANCH`   | No       | 20000   | Maximum files per branch      |
| `INDEX_CONCURRENCY`            | No       | 6       | Concurrent indexing workers   |
| `API_RPM`                      | No       | 240     | API rate limit per minute     |

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- View container status: `docker-compose ps`
- Restart services: `./deploy.sh`
