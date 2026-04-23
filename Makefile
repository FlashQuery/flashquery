ENV_FILE     := docker/.env.docker
FULL_COMPOSE := docker/docker-compose.yml
FQ_COMPOSE   := docker/docker-compose.flashquery-only.yml
DB_COMPOSE   := docker/docker-compose.db-only.yml

.PHONY: help \
        up down restart logs status build rebuild shell clean \
        fq-up fq-down fq-logs fq-status fq-build fq-rebuild fq-shell fq-watch \
        db-up db-down db-logs db-status

help:
	@echo ""
	@echo "FlashQuery — Docker targets"
	@echo ""
	@echo "Full stack  (Postgres + Supabase services + FlashQuery):"
	@echo "  make up        Start full stack in background"
	@echo "  make down      Stop full stack"
	@echo "  make restart   Restart all containers"
	@echo "  make logs      Tail all container logs"
	@echo "  make status    Show container status"
	@echo "  make build     Build FlashQuery image"
	@echo "  make rebuild   Force rebuild with no cache"
	@echo "  make shell     Open a shell in the FlashQuery container"
	@echo "  make clean     Stop and remove all volumes  ⚠ wipes data"
	@echo ""
	@echo "FlashQuery only  (connect to external/cloud Supabase):"
	@echo "  make fq-up     Start FlashQuery container in background"
	@echo "  make fq-down   Stop FlashQuery container"
	@echo "  make fq-logs   Tail FlashQuery container logs"
	@echo "  make fq-status Show FlashQuery container status"
	@echo "  make fq-build  Build FlashQuery image"
	@echo "  make fq-rebuild Force rebuild with no cache"
	@echo "  make fq-shell  Open a shell in the FlashQuery container"
	@echo "  make fq-watch  Start in foreground (logs stream to terminal)"
	@echo ""
	@echo "Database only  (Postgres + pgvector; FlashQuery runs locally via npm run dev):"
	@echo "  make db-up     Start database in background"
	@echo "  make db-down   Stop database"
	@echo "  make db-logs   Tail database logs"
	@echo "  make db-status Show database container status"
	@echo ""

# ── Full stack ────────────────────────────────────────────────────────────────

up:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) up -d

down:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) down

restart:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) restart

logs:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) logs -f

status:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) ps

build:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) build

rebuild:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) build --no-cache

shell:
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) exec flashquery sh

clean:
	@echo "WARNING: This will stop all containers and delete all volume data."
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ] || (echo "Aborted."; exit 1)
	docker compose --env-file $(ENV_FILE) -f $(FULL_COMPOSE) down -v

# ── FlashQuery only ───────────────────────────────────────────────────────────

fq-up:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) up -d

fq-down:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) down

fq-logs:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) logs -f

fq-status:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) ps

fq-build:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) build

fq-rebuild:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) build --no-cache

fq-shell:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) exec flashquery sh

fq-watch:
	docker compose --env-file $(ENV_FILE) -f $(FQ_COMPOSE) up

# ── Database only ─────────────────────────────────────────────────────────────

db-up:
	docker compose --env-file $(ENV_FILE) -f $(DB_COMPOSE) up -d

db-down:
	docker compose --env-file $(ENV_FILE) -f $(DB_COMPOSE) down

db-logs:
	docker compose --env-file $(ENV_FILE) -f $(DB_COMPOSE) logs -f

db-status:
	docker compose --env-file $(ENV_FILE) -f $(DB_COMPOSE) ps
