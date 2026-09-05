# Bash helper mirroring scripts/Enter-YanyiDev.ps1 for agent/CI shells.
# Usage: source scripts/yanyi-env.sh
set -a
YANYI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${YANYI_CONDA_ENV:-}" ]]; then
  if ! command -v conda >/dev/null 2>&1; then
    echo "Conda was not found. Install Miniconda/Anaconda and create the yanyi-dev environment." >&2
    return 1 2>/dev/null || exit 1
  fi
  YANYI_CONDA_ENV_WIN="$(conda run -n yanyi-dev python -c 'import sys; print(sys.prefix)' 2>/dev/null | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1)"
  if [[ -z "$YANYI_CONDA_ENV_WIN" ]]; then
    echo "Conda environment 'yanyi-dev' was not found. Create it from environment.yml first." >&2
    return 1 2>/dev/null || exit 1
  fi
  YANYI_CONDA_ENV="$(cygpath -u "$YANYI_CONDA_ENV_WIN" 2>/dev/null || printf '%s' "$YANYI_CONDA_ENV_WIN")"
elif command -v cygpath >/dev/null 2>&1; then
  YANYI_CONDA_ENV="$(cygpath -u "$YANYI_CONDA_ENV" 2>/dev/null || printf '%s' "$YANYI_CONDA_ENV")"
fi
RUSTUP_HOME="$(cygpath -w "$YANYI_ROOT/.devtools/rustup" 2>/dev/null || echo "$YANYI_ROOT/.devtools/rustup")"
CARGO_HOME="$(cygpath -w "$YANYI_ROOT/.devtools/cargo" 2>/dev/null || echo "$YANYI_ROOT/.devtools/cargo")"
PNPM_HOME="$(cygpath -w "$YANYI_ROOT/.devtools/pnpm" 2>/dev/null || echo "$YANYI_ROOT/.devtools/pnpm")"
PATH="$YANYI_ROOT/.devtools/cargo/bin:$YANYI_CONDA_ENV:$YANYI_CONDA_ENV/Library/bin:$YANYI_CONDA_ENV/Scripts:$PATH"
set +a

# conda's pnpm ships only as pnpm.bat on Windows; expose a bash-callable shim.
pnpm() { cmd //c "$(cygpath -w "$YANYI_CONDA_ENV/Library/bin/pnpm.bat")" "$@"; }
export -f pnpm 2>/dev/null || true

echo "Yanyi env ready: node=$(node --version) pnpm=$(pnpm --version 2>&1 | tail -1) cargo=$(cargo --version)"
