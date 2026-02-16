set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set dotenv-load := true
app_host := env_var_or_default("APP_HOST", "0.0.0.0")
app_port := env_var_or_default("APP_PORT", "8080")

# Show recipe list.
default:
    @just --list

# --- Portal lifecycle ---

# Install dependencies and create venv via uv.
setup:
    uv sync

# Create local .env from template if it does not exist.
init-env:
    test -f .env && echo ".env already exists" || { cp .env.example .env; echo "Created .env from .env.example"; }

# Run portal in dev mode (reload enabled).
# Uses APP_HOST/APP_PORT from env by default.
dev host=app_host port=app_port:
    uv run uvicorn app.main:app --reload --host "{{host}}" --port "{{port}}"

# Run portal in non-reload mode.
serve host=app_host port=app_port:
    uv run uvicorn app.main:app --host "{{host}}" --port "{{port}}"

# Build Docker image.
docker-build:
    docker build -t maxpect-light-controller:latest .

# Run with Docker Compose (detached).
docker-up:
    docker compose up -d --build

# Stop Docker Compose stack.
docker-down:
    docker compose down

# Run full automated test suite.
test:
    uv run --group dev pytest -q

# Run static lint checks.
lint:
    uv run --group dev ruff check app tests

# Run type checks.
typecheck:
    uv run --group dev mypy app

# Auto-format Python code.
format:
    uv run --group dev black app tests scripts
    uv run --group dev ruff check --fix app tests

# Run tests with coverage report in terminal.
coverage:
    uv run --group dev pytest -q --cov=app --cov-report=term-missing

# Full local CI suite.
check: lint typecheck test

# Quick healthcheck against a running portal.
health base="http://127.0.0.1:8080":
    curl -sS "{{base}}/healthz" | python3 -m json.tool

# Pull current state from running portal.
state base="http://127.0.0.1:8080":
    curl -sS "{{base}}/api/state" | python3 -m json.tool

# Trigger one validation run.
validate-now base="http://127.0.0.1:8080":
    curl -sS -X POST "{{base}}/api/validation/run" | python3 -m json.tool

# Show latest validation result.
validate-latest base="http://127.0.0.1:8080":
    curl -sS "{{base}}/api/validation/latest" | python3 -m json.tool

# Export presets to JSON file.
export-presets outfile="presets-export.json" base="http://127.0.0.1:8080":
    curl -sS "{{base}}/api/presets" | python3 -m json.tool > "{{outfile}}"
    echo "Wrote {{outfile}}"

# --- Protocol analysis ---

# Parse IoT command/response payloads from a pcap/pcapng.
# Usage:
#   just parse idle.pcapng
#   just parse capture.pcapng src=10.0.2.169 dst=10.0.2.116 port=80
parse pcap src="10.0.2.169" dst="10.0.2.116" port="80":
    base="$(basename "{{pcap}}")"
    base="${base%.*}"

    tshark -r "{{pcap}}" \
      -Y "ip.src=={{src}} && ip.dst=={{dst}} && tcp.dstport=={{port}} && tcp.len>0" \
      -T fields -e frame.number -e frame.time_epoch -e tcp.payload \
      > "${base}_commands_payloads.tsv"

    tshark -r "{{pcap}}" \
      -Y "ip.src=={{dst}} && ip.dst=={{src}} && tcp.srcport=={{port}} && tcp.len>0" \
      -T fields -e frame.number -e frame.time_epoch -e tcp.payload \
      > "${base}_responses_payloads.tsv"

    echo "Wrote ${base}_commands_payloads.tsv and ${base}_responses_payloads.tsv"

# Decode protocol frames into annotated TSV/JSON.
# Usage:
#   just decode switchmode.pcapng
#   just decode capture.pcapng format=json pretty=true
#   just decode capture.pcapng format=json stdout=true
#   just decode capture.pcapng format=json include_keepalive=true exclude_acks=true
decode pcap port="80" src="" dst="" format="tsv" json_mode="semantic" include_keepalive="false" exclude_acks="false" pretty="false" stdout="false":
    args=(scripts/decode_iot_frames.py "{{pcap}}" --port "{{port}}" --format "{{format}}" --json-mode "{{json_mode}}")
    [[ -n "{{src}}" ]] && args+=(--src "{{src}}") || true
    [[ -n "{{dst}}" ]] && args+=(--dst "{{dst}}") || true
    [[ "{{include_keepalive}}" == "true" ]] && args+=(--include-keepalive) || true
    [[ "{{exclude_acks}}" == "true" ]] && args+=(--exclude-acks) || true
    [[ "{{pretty}}" == "true" ]] && args+=(--pretty) || true
    [[ "{{stdout}}" == "true" ]] && args+=(--stdout) || true

    python3 "${args[@]}"

# --- Live control probes ---

# Active control probe against a live device.
# Usage:
#   just control-light 10.0.2.116 R5S2A000188 query-mode
#   just control-light 10.0.2.116 R5S2A000188 set-mode mode=manual verify=true
#   just control-light 10.0.2.116 R5S2A000188 query-mode dry_run=true
control-light host device_id action mode="manual" port="80" timeout="2.0" verify="false" dry_run="false":
    args=(scripts/control_lights.py --host "{{host}}" --port "{{port}}" --device-id "{{device_id}}" --timeout "{{timeout}}")
    [[ "{{action}}" == "query-mode" ]] && { args+=(query-mode); [[ "{{dry_run}}" == "true" ]] && args+=(--dry-run) || true; } || true
    [[ "{{action}}" == "set-mode" ]] && { args+=(set-mode "{{mode}}"); [[ "{{verify}}" == "true" ]] && args+=(--verify) || true; [[ "{{dry_run}}" == "true" ]] && args+=(--dry-run) || true; } || true
    [[ "{{action}}" == "query-mode" || "{{action}}" == "set-mode" ]] || { echo "action must be query-mode or set-mode" >&2; exit 2; }

    python3 "${args[@]}"
