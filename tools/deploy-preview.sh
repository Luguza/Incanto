#!/usr/bin/env bash
# Publish a branch to the live site for review.
#
# GitHub Pages is wired to the `gh-pages` branch (repo Settings > Pages). That
# setting never changes — this script just moves what `gh-pages` *contains* to
# the branch you want to preview, so any branch can go live at
# https://luguza.github.io/Incanto/ without touching the Pages configuration.
#
# NOTE: there is only one public Pages site, so "previewing" a branch here means
# temporarily publishing it publicly.
#
# Usage:
#   ./tools/deploy-preview.sh            # publish the current branch
#   ./tools/deploy-preview.sh <branch>   # publish a specific branch
set -euo pipefail

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"

echo "Publishing '$branch' -> gh-pages (https://luguza.github.io/Incanto/)"
git push origin "$branch:gh-pages" --force
echo "Done. GitHub Pages redeploys in ~1 minute."
