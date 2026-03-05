#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARTIFACT_ROOT="${BACKEND_DIR}/.artifacts"
PACKAGE_DIR="${ARTIFACT_ROOT}/lambda"
ZIP_PATH="${ARTIFACT_ROOT}/artizans-backend-lambda.zip"

cd "${BACKEND_DIR}"

npm run build --silent

rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}"
cp -R "${BACKEND_DIR}/dist/src" "${PACKAGE_DIR}/src"

cat > "${PACKAGE_DIR}/index.js" <<'EOF'
export { handler } from "./src/lambda/index.js";
EOF

cat > "${PACKAGE_DIR}/package.json" <<'EOF'
{
  "type": "module"
}
EOF

rm -f "${ZIP_PATH}"
(
  cd "${PACKAGE_DIR}"
  zip -qr "${ZIP_PATH}" .
)

echo "Created Lambda artifact: ${ZIP_PATH}"
