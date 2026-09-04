#!/usr/bin/env bash
# Rebuild demos/plant-a-thought.html from the site's template + the model export
# and engine in the research repo (context-bank-study). Two copies per card.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 ~/Documents/rEverything/projects/Claude/context-bank-study/build_game.py "$PWD/public/demos/plant-a-thought.html" 2 "$PWD/tools/plant-a-thought.template.html"
