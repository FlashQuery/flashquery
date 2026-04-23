#!/bin/bash -e
# ============================================================================
# FlashQuery Core — Interactive Setup
# ============================================================================
# Generates:
#   ./.env                     (always — the FlashQuery application env file)
#   ./flashquery.yml           (always — copied from flashquery.example.yml)
#   ./docker/.env.docker       (only on option 3 — the bundled Docker stack)
#
# Re-runnable: if any of these files already exist, existing values are
# loaded as defaults for re-prompts. A second run adds docker/.env.docker
# without disturbing an already-populated root .env.
#
# Usage:
#   bash setup.sh
#   npm run setup
# ============================================================================

# ─── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ─── Prompt helpers ──────────────────────────────────────────────────────────

prompt_with_default() {
  local var_name="$1" prompt_text="$2" default_val="$3" input
  if [ -n "$default_val" ]; then
    printf "%b%s%b [%b%s%b]: " "$CYAN" "$prompt_text" "$RESET" "$YELLOW" "$default_val" "$RESET"
  else
    printf "%b%s%b: " "$CYAN" "$prompt_text" "$RESET"
  fi
  read -r input
  # Strip tabs, carriage returns, and newlines that can appear as paste
  # artifacts (some terminals send \r\n; read strips \n but leaves \r).
  # Regular spaces are preserved so names and paths with spaces still work.
  input="${input//[$'\t\r\n']}"
  [ -z "$input" ] && input="$default_val"
  printf -v "$var_name" '%s' "$input"
}

prompt_required() {
  local var_name="$1" prompt_text="$2" default_val="${3:-}" input
  while true; do
    if [ -n "$default_val" ]; then
      printf "%b%s%b [%b%s%b]: " "$CYAN" "$prompt_text" "$RESET" "$YELLOW" "$default_val" "$RESET"
    else
      printf "%b%s%b (required): " "$CYAN" "$prompt_text" "$RESET"
    fi
    read -r input
    # Strip tabs, carriage returns, and newlines — paste artifacts that have
    # no place in URLs, keys, IDs, or paths. Spaces are preserved intentionally
    # so that instance names ("My FlashQuery") and paths with spaces work.
    input="${input//[$'\t\r\n']}"
    [ -z "$input" ] && input="$default_val"
    if [ -n "$input" ]; then
      printf -v "$var_name" '%s' "$input"
      return
    fi
    printf "%bThis field is required.%b\n" "$YELLOW" "$RESET"
  done
}

warn_on_change() {
  # If the user changed a sensitive field from its previous value, print a
  # warning explaining the impact and ask for confirmation. Exit code 1 means
  # "user declined" — caller should revert to the old value.
  local old="$1" new="$2" field="$3" message="$4"
  [ -z "$old" ] && return 0          # no prior value, nothing to warn about
  [ "$old" = "$new" ] && return 0    # unchanged, nothing to warn about
  echo ""
  printf "%b⚠  You are changing %s%b\n" "$YELLOW" "$field" "$RESET"
  printf "   Previous:  %s\n" "$old"
  printf "   New:       %s\n" "$new"
  printf "   Impact:    %s\n" "$message"
  local answer
  printf "%bContinue with the new value?%b [y/N]: " "$CYAN" "$RESET"
  read -r answer
  if [[ "$answer" =~ ^[Yy] ]]; then
    return 0
  fi
  printf "%bReverting to previous value.%b\n" "$GREEN" "$RESET"
  return 1
}

prompt_enum() {
  local var_name="$1" prompt_text="$2" options_str="$3" default_val="$4" input
  while true; do
    printf "%b%s%b (%s) [%b%s%b]: " "$CYAN" "$prompt_text" "$RESET" "$options_str" "$YELLOW" "$default_val" "$RESET"
    read -r input
    [ -z "$input" ] && input="$default_val"
    # Use bash pattern matching instead of grep so that inputs starting with
    # a dash (e.g. a pasted API key fragment that bled into this prompt) are
    # never misinterpreted as grep flags.
    if [[ "|${options_str}|" == *"|${input}|"* ]]; then
      printf -v "$var_name" '%s' "$input"
      return
    fi
    printf "%bInvalid option '%s'. Choose one of: %s%b\n" "$YELLOW" "$input" "$options_str" "$RESET"
  done
}

# ─── Utility: load an existing .env file's keys into the shell ───────────────
# Only picks up keys we know about; unknown keys in the file pass through.
# Commented lines are ignored. Called for backward-compat on re-runs.

load_env_keys() {
  local file="$1"
  shift
  [ ! -f "$file" ] && return 0
  local key
  for key in "$@"; do
    # Grab the first non-comment occurrence of KEY=...
    local value
    value=$(grep -E "^${key}=" "$file" 2>/dev/null | head -n1 | cut -d= -f2-)
    if [ -n "$value" ]; then
      printf -v "$key" '%s' "$value"
    fi
  done
}

# ─── Utility: render an env template, substituting shell-set values ──────────
# Reads TEMPLATE line by line and writes to OUTPUT. For any line that looks
# like `KEY=...`, if a shell variable of the same name is set (even to empty),
# the value is substituted; otherwise the line passes through unchanged.
# Comments and blank lines are preserved verbatim — this is how we keep the
# rich inline docs from the .example files in the generated .env files.

render_env_template() {
  local template="$1" output="$2"
  local line key
  : > "$output"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]]; then
      key="${BASH_REMATCH[1]}"
      if declare -p "$key" >/dev/null 2>&1; then
        printf '%s=%s\n' "$key" "${!key}" >> "$output"
        continue
      fi
    fi
    printf '%s\n' "$line" >> "$output"
  done < "$template"
}

# ─── Utility: generate a Supabase-style JWT signed with HS256 ────────────────
# Used on option 3 to produce SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
# from the locally-generated SUPABASE_JWT_SECRET. Tokens are valid for 100
# years — the bundled stack isn't meant for long-lived production use, and
# expiring dev tokens would just frustrate users. Change this if you know
# you need tighter bounds.

generate_jwt() {
  local role="$1" secret="$2"
  local iat exp header_b64 payload_b64 msg sig
  iat=$(date +%s)
  exp=$((iat + 100 * 365 * 24 * 3600))
  header_b64=$(printf '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  payload_b64=$(printf '{"role":"%s","iss":"supabase-bundled","iat":%s,"exp":%s}' "$role" "$iat" "$exp" \
    | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  msg="${header_b64}.${payload_b64}"
  sig=$(printf '%s' "$msg" | openssl dgst -binary -sha256 -hmac "$secret" \
    | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  printf '%s.%s' "$msg" "$sig"
}

# ─── Utility: offer to git init the vault ────────────────────────────────────

ensure_vault_is_git_repo() {
  local vault="$1"
  if ! command -v git >/dev/null 2>&1; then
    printf "%bgit is not installed; skipping vault git init. flashquery.yml has git.auto_commit: true — you'll want to install git before running FlashQuery, or set auto_commit: false.%b\n" "$YELLOW" "$RESET"
    return
  fi
  if [ ! -d "$vault" ]; then
    mkdir -p "$vault"
    printf "  Created vault directory: %s\n" "$vault"
  fi
  if [ -d "$vault/.git" ]; then
    return
  fi
  printf "\n%bYour vault at %s is not a git repository.%b\n" "$YELLOW" "$vault" "$RESET"
  echo "flashquery.yml has git.auto_commit enabled by default, which requires a git repo."
  local answer
  printf "%bInitialize it now?%b (Y/n): " "$CYAN" "$RESET"
  read -r answer
  answer="${answer:-Y}"
  if [[ "$answer" =~ ^[Yy] ]]; then
    ( cd "$vault" && git init -q -b main \
        && git commit --allow-empty -q -m "Initialize vault for FlashQuery" )
    printf "  %bInitialized git repo at %s%b\n" "$GREEN" "$vault" "$RESET"
  else
    printf "  %bSkipped. Set git.auto_commit: false in flashquery.yml before running FlashQuery.%b\n" "$YELLOW" "$RESET"
  fi
}

# ─── Banner ──────────────────────────────────────────────────────────────────
echo ""
printf "%b============================================================%b\n" "$BOLD" "$RESET"
printf "%b  FlashQuery Core — Configuration Setup%b\n" "$BOLD" "$RESET"
printf "%b============================================================%b\n" "$BOLD" "$RESET"
echo ""

EXISTING_ENV=""
if [ -f ".env" ]; then
  EXISTING_ENV=1
  echo "Found existing .env — current values will be offered as defaults."
  echo "Press Enter to keep a value, or type a new one to update it."
  echo ""
  printf "%bPreserved automatically (not prompted):%b\n" "$BOLD" "$RESET"
  echo "  • MCP_AUTH_SECRET  — kept; changing it invalidates issued bearer tokens"
  if [ -f "docker/.env.docker" ]; then
    echo "  • POSTGRES_PASSWORD, SUPABASE_JWT_SECRET  — kept; changing either"
    echo "    would break an already-running bundled Docker stack"
  fi
  echo ""
  printf "%bPrompted but sensitive — you'll be warned before changing:%b\n" "$BOLD" "$RESET"
  echo "  • INSTANCE_ID       — every DB row is tagged with this"
  echo "  • SUPABASE_URL      — points FlashQuery at a specific backend"
  echo "  • DATABASE_URL      — ditto"
  echo "  • EMBEDDING_MODEL   — changes make existing embeddings invalid"
else
  echo "This script will generate ./.env and ./flashquery.yml for your"
  echo "FlashQuery Core installation. If you're using the bundled Docker"
  echo "stack, it'll also generate ./docker/.env.docker."
fi
echo ""

# ─── Load existing values for re-run defaults ────────────────────────────────
load_env_keys ".env" \
  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL \
  INSTANCE_NAME INSTANCE_ID VAULT_PATH \
  EMBEDDING_PROVIDER EMBEDDING_API_KEY EMBEDDING_MODEL OLLAMA_URL \
  MCP_AUTH_SECRET LOG_LEVEL NODE_ENV
load_env_keys "docker/.env.docker" \
  POSTGRES_PASSWORD SUPABASE_JWT_SECRET SUPABASE_ANON_KEY LOG_PATH

# ─── Step 1: Supabase path ───────────────────────────────────────────────────
# Infer the previous choice so re-runs default to what the user picked last
# time. Heuristic: if docker/.env.docker exists, they were on option 3.
# Otherwise, if SUPABASE_URL looks like a *.supabase.co URL, they were on
# option 1; if it looks local, option 2; fall back to option 1.
if [ -f "docker/.env.docker" ]; then
  SUPABASE_CHOICE_DEFAULT="3"
elif [[ "${SUPABASE_URL:-}" == *".supabase.co"* ]]; then
  SUPABASE_CHOICE_DEFAULT="1"
elif [[ "${SUPABASE_URL:-}" == http://localhost* || "${SUPABASE_URL:-}" == http://127.0.0.1* ]]; then
  SUPABASE_CHOICE_DEFAULT="2"
else
  SUPABASE_CHOICE_DEFAULT="1"
fi

echo "--- Supabase ---"
echo ""
echo "How are you running Supabase?"
echo "  1) Supabase Cloud         — using a project at supabase.com"
echo "  2) Existing self-hosted   — a Supabase instance you already run"
echo "  3) Bundled Docker stack   — run Supabase locally via docker/docker-compose.yml"
echo ""
prompt_enum SUPABASE_CHOICE "Choice" "1|2|3" "$SUPABASE_CHOICE_DEFAULT"
echo ""

case "$SUPABASE_CHOICE" in
  1)
    # Cloud
    OLD_SUPABASE_URL="${SUPABASE_URL:-}"
    OLD_DATABASE_URL="${DATABASE_URL:-}"
    prompt_required SUPABASE_URL "SUPABASE_URL (e.g. https://xxx.supabase.co)" "${SUPABASE_URL:-}"
    warn_on_change "$OLD_SUPABASE_URL" "$SUPABASE_URL" "SUPABASE_URL" \
      "FlashQuery will point at a different Supabase project. Data written to the old project will remain there but won't be visible in this installation." \
      || SUPABASE_URL="$OLD_SUPABASE_URL"
    prompt_required SUPABASE_SERVICE_ROLE_KEY "SUPABASE_SERVICE_ROLE_KEY" "${SUPABASE_SERVICE_ROLE_KEY:-}"
    prompt_required DATABASE_URL "DATABASE_URL (Postgres connection string)" "${DATABASE_URL:-}"
    warn_on_change "$OLD_DATABASE_URL" "$DATABASE_URL" "DATABASE_URL" \
      "FlashQuery will connect to a different Postgres database. Data in the previous database remains but won't be visible here." \
      || DATABASE_URL="$OLD_DATABASE_URL"
    ;;
  2)
    # Existing self-hosted
    OLD_SUPABASE_URL="${SUPABASE_URL:-}"
    OLD_DATABASE_URL="${DATABASE_URL:-}"
    prompt_required SUPABASE_URL "SUPABASE_URL" "${SUPABASE_URL:-http://localhost:8000}"
    warn_on_change "$OLD_SUPABASE_URL" "$SUPABASE_URL" "SUPABASE_URL" \
      "FlashQuery will point at a different Supabase instance. Data written to the old instance remains there but won't be visible here." \
      || SUPABASE_URL="$OLD_SUPABASE_URL"
    prompt_required SUPABASE_SERVICE_ROLE_KEY "SUPABASE_SERVICE_ROLE_KEY" "${SUPABASE_SERVICE_ROLE_KEY:-}"
    prompt_required DATABASE_URL "DATABASE_URL" "${DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres}"
    warn_on_change "$OLD_DATABASE_URL" "$DATABASE_URL" "DATABASE_URL" \
      "FlashQuery will connect to a different Postgres database. Data in the previous database remains but won't be visible here." \
      || DATABASE_URL="$OLD_DATABASE_URL"
    ;;
  3)
    # Bundled Docker stack — generate secrets on first run; keep across re-runs.
    echo "Bundled Docker stack selected."
    JWT_SECRET_FRESH=""
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
      POSTGRES_PASSWORD=$(openssl rand -hex 32)
      printf "  %bGenerated POSTGRES_PASSWORD%b\n" "$GREEN" "$RESET"
    else
      printf "  Keeping existing POSTGRES_PASSWORD from docker/.env.docker\n"
    fi
    if [ -z "${SUPABASE_JWT_SECRET:-}" ]; then
      SUPABASE_JWT_SECRET=$(openssl rand -hex 32)
      JWT_SECRET_FRESH=1
      printf "  %bGenerated SUPABASE_JWT_SECRET%b\n" "$GREEN" "$RESET"
    else
      printf "  Keeping existing SUPABASE_JWT_SECRET from docker/.env.docker\n"
    fi
    # Derived keys: only regenerate if the JWT secret is fresh or the keys
    # don't exist yet. Signing with an unchanged secret would produce
    # different JWTs every run (fresh iat timestamp) — which is wasteful
    # noise and makes the output look like something changed when it didn't.
    if [ -n "$JWT_SECRET_FRESH" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
      SUPABASE_ANON_KEY=$(generate_jwt "anon" "$SUPABASE_JWT_SECRET")
      printf "  %bGenerated SUPABASE_ANON_KEY (signed JWT)%b\n" "$GREEN" "$RESET"
    else
      printf "  Keeping existing SUPABASE_ANON_KEY\n"
    fi
    if [ -n "$JWT_SECRET_FRESH" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
      SUPABASE_SERVICE_ROLE_KEY=$(generate_jwt "service_role" "$SUPABASE_JWT_SECRET")
      printf "  %bGenerated SUPABASE_SERVICE_ROLE_KEY (signed JWT)%b\n" "$GREEN" "$RESET"
    else
      printf "  Keeping existing SUPABASE_SERVICE_ROLE_KEY\n"
    fi
    # Fixed endpoints for the bundled stack (overwrite — these are canonical
    # for the bundled setup and the user shouldn't be changing them).
    SUPABASE_URL="http://localhost:8000"
    DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/flashquery"
    ;;
esac

# ─── Step 2: Instance identity ───────────────────────────────────────────────
echo ""
echo "--- Instance Identity ---"
prompt_required INSTANCE_NAME "Instance name" "${INSTANCE_NAME:-My FlashQuery}"
OLD_INSTANCE_ID="${INSTANCE_ID:-}"
if [ -z "${INSTANCE_ID:-}" ]; then
  INSTANCE_ID_DEFAULT="i-$(date +%s | tail -c 7 | head -c 6)"
else
  INSTANCE_ID_DEFAULT="$INSTANCE_ID"
fi
prompt_required INSTANCE_ID "Instance ID (used in every DB row; must be unique per DB)" "$INSTANCE_ID_DEFAULT"
warn_on_change "$OLD_INSTANCE_ID" "$INSTANCE_ID" "INSTANCE_ID" \
  "FlashQuery tags every database row with this ID. Changing it makes this installation stop seeing data tagged with the previous ID — the rows stay in the database but appear invisible here. Revert the ID to recover visibility." \
  || INSTANCE_ID="$OLD_INSTANCE_ID"

# ─── Step 3: Vault ───────────────────────────────────────────────────────────
echo ""
echo "--- Vault ---"
echo "Path to your markdown vault (Obsidian-compatible directory)."
prompt_required VAULT_PATH "Vault path (absolute or relative)" "${VAULT_PATH:-./vault}"

# ─── Step 4: Embedding ───────────────────────────────────────────────────────
echo ""
echo "--- Embedding Provider (semantic search) ---"
echo "  openai     — OpenAI API (requires EMBEDDING_API_KEY)"
echo "  openrouter — OpenRouter API (requires EMBEDDING_API_KEY)"
echo "  ollama     — Local Ollama (no API key needed)"
echo "  none       — Disable semantic search entirely"
prompt_enum EMBEDDING_PROVIDER "Embedding provider" "openai|openrouter|ollama|none" "${EMBEDDING_PROVIDER:-openai}"

case "$EMBEDDING_PROVIDER" in
  openai)      DEFAULT_MODEL="text-embedding-3-small" ;;
  openrouter)  DEFAULT_MODEL="openai/text-embedding-3-small" ;;
  ollama)      DEFAULT_MODEL="nomic-embed-text" ;;
  none)        DEFAULT_MODEL="" ;;
esac
if [ -n "${EMBEDDING_MODEL:-}" ]; then
  DEFAULT_MODEL="$EMBEDDING_MODEL"
fi

if [ "$EMBEDDING_PROVIDER" = "none" ]; then
  EMBEDDING_MODEL=""
  EMBEDDING_API_KEY=""
else
  OLD_EMBEDDING_MODEL="${EMBEDDING_MODEL:-}"
  prompt_required EMBEDDING_MODEL "Embedding model" "$DEFAULT_MODEL"
  warn_on_change "$OLD_EMBEDDING_MODEL" "$EMBEDDING_MODEL" "EMBEDDING_MODEL" \
    "Existing embeddings were generated with the old model and won't match the new one. Semantic search on previously-indexed documents may return poor or empty results until they are re-embedded. Also verify that 'dimensions' in flashquery.yml matches the new model's native size (1536 for text-embedding-3-small, 3072 for text-embedding-3-large, 768 for nomic-embed-text)." \
    || EMBEDDING_MODEL="$OLD_EMBEDDING_MODEL"
  if [ "$EMBEDDING_PROVIDER" = "ollama" ]; then
    EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-}"  # Ollama uses no key; keep whatever's there
    prompt_required OLLAMA_URL "Ollama base URL" "${OLLAMA_URL:-http://localhost:11434}"
  else
    OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"  # keep default; not used for this provider
    prompt_required EMBEDDING_API_KEY "Embedding API key" "${EMBEDDING_API_KEY:-}"
  fi
fi

# ─── Step 5: Logging ─────────────────────────────────────────────────────────
echo ""
echo "--- Logging ---"
prompt_enum LOG_LEVEL "Log level" "debug|info|warn|error" "${LOG_LEVEL:-info}"

# ─── Step 6: MCP auth secret ─────────────────────────────────────────────────
echo ""
echo "--- MCP Authentication ---"
if [ -n "${MCP_AUTH_SECRET:-}" ]; then
  echo "Keeping existing MCP_AUTH_SECRET from .env."
  MCP_AUTH_GENERATED=""
else
  MCP_AUTH_SECRET=$(openssl rand -hex 32)
  MCP_AUTH_GENERATED=1
  printf "  %bGenerated MCP_AUTH_SECRET%b\n" "$GREEN" "$RESET"
  echo "  This signs bearer tokens for streamable-http MCP transport."
fi

# ─── Step 7: NODE_ENV ────────────────────────────────────────────────────────
: "${NODE_ENV:=development}"

# ─── Step 8: Render .env from the template ───────────────────────────────────
if [ ! -f ".env.example" ]; then
  printf "%bError: .env.example not found in %s — cannot generate .env.%b\n" "$RED" "$PROJECT_ROOT" "$RESET" >&2
  exit 1
fi
render_env_template ".env.example" ".env"

# ─── Step 9: Copy flashquery.example.yml → flashquery.yml ────────────────────
if [ ! -f "flashquery.example.yml" ]; then
  printf "%bError: flashquery.example.yml not found — cannot generate flashquery.yml.%b\n" "$RED" "$RESET" >&2
  exit 1
fi
cp flashquery.example.yml flashquery.yml

# ─── Step 10: Bundled Docker — render docker/.env.docker ─────────────────────
if [ "$SUPABASE_CHOICE" = "3" ]; then
  if [ ! -f "docker/.env.docker.example" ]; then
    printf "%bError: docker/.env.docker.example not found — cannot generate docker/.env.docker.%b\n" "$RED" "$RESET" >&2
    exit 1
  fi
  # LOG_PATH is docker-only with a safe default
  : "${LOG_PATH:=./logs}"
  render_env_template "docker/.env.docker.example" "docker/.env.docker"
fi

# ─── Step 10b: Write .env.test ────────────────────────────────────────────────
# For the bundled Docker stack, .env.test must match .env.docker credentials —
# generate it automatically every time (credentials come from .env.docker so
# they stay in sync across re-runs). For options 1/2, write it only if it
# doesn't exist yet (user may have filled in values we shouldn't overwrite).
ENV_TEST_WRITTEN=""
if [ "$SUPABASE_CHOICE" = "3" ] || [ ! -f ".env.test" ]; then
  # OPENAI_API_KEY in .env.test comes from EMBEDDING_API_KEY when using openai/openrouter.
  # Ollama and "none" providers leave it blank — embedding tests will skip.
  TEST_OPENAI_API_KEY=""
  if [ "$EMBEDDING_PROVIDER" = "openai" ] || [ "$EMBEDDING_PROVIDER" = "openrouter" ]; then
    TEST_OPENAI_API_KEY="${EMBEDDING_API_KEY:-}"
  fi
  TEST_OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

  cat > ".env.test" <<EOF
# Auto-generated by setup.sh — re-run setup to regenerate after credential changes.
# .env.test is gitignored and will NOT be committed.

# Required for integration tests
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
DATABASE_URL=${DATABASE_URL}

# Required for MCP bearer-token auth (used by the scenario test suite)
MCP_AUTH_SECRET=${MCP_AUTH_SECRET}

# Required for embedding tests
OPENAI_API_KEY=${TEST_OPENAI_API_KEY}

# Optional — only needed for Ollama embedding tests
OLLAMA_URL=${TEST_OLLAMA_URL}
EOF
  ENV_TEST_WRITTEN=1
fi

# ─── Step 11: Offer to git init the vault ────────────────────────────────────
echo ""
ensure_vault_is_git_repo "$VAULT_PATH"

# ─── Step 12: Summary ────────────────────────────────────────────────────────
echo ""
printf "%b============================================================%b\n" "$BOLD" "$RESET"
printf "%b  Setup complete%b\n" "$BOLD" "$RESET"
printf "%b============================================================%b\n" "$BOLD" "$RESET"
echo ""
printf "  %b./.env%b                written\n" "$GREEN" "$RESET"
printf "  %b./flashquery.yml%b      written (copy of flashquery.example.yml)\n" "$GREEN" "$RESET"
if [ "$SUPABASE_CHOICE" = "3" ]; then
  printf "  %b./docker/.env.docker%b  written\n" "$GREEN" "$RESET"
fi
if [ -n "$ENV_TEST_WRITTEN" ]; then
  printf "  %b./.env.test%b           written (credentials synced from .env)\n" "$GREEN" "$RESET"
fi
echo ""

if [ -n "$MCP_AUTH_GENERATED" ]; then
  echo "MCP_AUTH_SECRET was generated. After starting FlashQuery, copy the"
  echo "bearer token it prints into your MCP client config (Claude Desktop,"
  echo "Claude Code, Claude Cowork, etc.)."
  echo ""
fi

if [ "$SUPABASE_CHOICE" = "3" ]; then
  echo "Next steps for the bundled Docker stack:"
  echo ""
  echo "  1. Start the stack:"
  echo "       cd docker && docker compose --env-file .env.docker up -d"
  echo ""
  echo "  2. Once Supabase is healthy, start FlashQuery:"
  echo "       npm run dev"
  echo "       # or: flashquery start --config ./flashquery.yml"
  echo ""
  echo "  3. Supabase Studio (admin UI) will be available at:"
  echo "       http://localhost:3001"
  echo ""
else
  echo "Next steps:"
  echo ""
  echo "  1. Double-check your .env — secrets should look right before starting."
  echo ""
  echo "  2. Start FlashQuery:"
  echo "       npm run dev"
  echo "       # or: flashquery start --config ./flashquery.yml"
  echo ""
fi

echo "See README.md for MCP client configuration and token issuance details."
echo ""
