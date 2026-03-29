#!/bin/bash
# Minify JS and CSS for production deploy
# Run from project root: bash scripts/minify.sh

set -e

echo "Minifying CSS..."
for f in styles/base.css styles/components.css styles/pages.css; do
  if [ -f "$f" ]; then
    npx clean-css-cli -o "$f" "$f"
    echo "  $f → $(wc -c < "$f" | tr -d ' ') bytes"
  fi
done

echo "Minifying JS..."
for f in js/utils.js js/session.js js/aws-config.js js/api-client.js js/cognito-auth.js js/store.js js/shared-nav.js js/renderers.js js/router-guards.js js/public-home.js js/explore.js js/artist-preview.js js/auth.js js/static-page.js js/contact.js js/unauthorized.js; do
  if [ -f "$f" ]; then
    npx terser "$f" --compress --mangle --module -o "$f"
    echo "  $f → $(wc -c < "$f" | tr -d ' ') bytes"
  fi
done

echo "Done."
