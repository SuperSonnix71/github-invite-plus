#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  GitHub Invite Plus - Docker Deploy${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo -e "${YELLOW}Please copy .env.example to .env and configure it:${NC}"
    echo -e "  cd $SCRIPT_DIR"
    echo -e "  cp .env.example .env"
    echo -e "  nano .env"
    exit 1
fi

echo -e "${YELLOW}Loading environment variables...${NC}"
source "$SCRIPT_DIR/.env"

echo -e "${YELLOW}Stopping and removing existing containers...${NC}"
cd "$SCRIPT_DIR"
docker-compose down --remove-orphans 2>/dev/null || true

echo -e "${YELLOW}Removing existing images...${NC}"
docker rmi gip-server:latest 2>/dev/null || true
docker rmi $(docker images -q "docker-server" 2>/dev/null) 2>/dev/null || true

echo -e "${YELLOW}Cleaning up dangling images and volumes...${NC}"
docker system prune -f --volumes 2>/dev/null || true

echo -e "${GREEN}Building and starting services...${NC}"
docker-compose up -d --build

echo ""
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 5

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    MEILI_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' gip-meilisearch 2>/dev/null || echo "starting")
    SERVER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' gip-server 2>/dev/null || echo "starting")

    if [ "$MEILI_HEALTH" = "healthy" ] && [ "$SERVER_HEALTH" = "healthy" ]; then
        echo -e "${GREEN}✓ All services are healthy!${NC}"
        break
    fi

    echo -e "${YELLOW}  Meilisearch: $MEILI_HEALTH, Server: $SERVER_HEALTH (${RETRY_COUNT}/${MAX_RETRIES})${NC}"
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}Warning: Services did not become healthy within expected time${NC}"
    echo -e "${YELLOW}Check logs with: docker-compose logs${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Services Status:${NC}"
docker-compose ps
echo ""
echo -e "${GREEN}Access URLs:${NC}"
echo -e "  Server:      ${BLUE}http://0.0.0.0:8787${NC}"
echo -e "  Meilisearch: ${BLUE}http://0.0.0.0:7700${NC}"
echo -e "  Health:      ${BLUE}http://0.0.0.0:8787/api/health${NC}"
echo ""
echo -e "${YELLOW}Useful Commands:${NC}"
echo -e "  View logs:        ${BLUE}docker-compose -f $SCRIPT_DIR/docker-compose.yml logs -f${NC}"
echo -e "  Stop services:    ${BLUE}docker-compose -f $SCRIPT_DIR/docker-compose.yml down${NC}"
echo -e "  Restart services: ${BLUE}docker-compose -f $SCRIPT_DIR/docker-compose.yml restart${NC}"
echo -e "  View server logs: ${BLUE}docker logs -f gip-server${NC}"
echo -e "  View meili logs:  ${BLUE}docker logs -f gip-meilisearch${NC}"
echo ""
echo -e "${GREEN}Remote Access:${NC}"
echo -e "  The services are bound to 0.0.0.0, making them accessible from:"
echo -e "  - Local network: ${BLUE}http://<your-local-ip>:8787${NC}"
echo -e "  - Remote clients: ${BLUE}http://<your-public-ip>:8787${NC}"
echo ""
echo -e "${YELLOW}Security Note:${NC}"
echo -e "  Ensure your firewall allows ports 8787 and 7700 (if needed)"
echo -e "  Consider using a reverse proxy (nginx/traefik) with SSL for production"
echo ""
