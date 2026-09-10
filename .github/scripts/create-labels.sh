#!/bin/bash
# Create labels for kvnloo/dash GitHub repository
# Requires: gh CLI (GitHub CLI) authenticated
# Usage: ./.github/scripts/create-labels.sh

set -e

echo "Creating labels for kvnloo/dash..."
echo ""

# Area labels
echo "📦 Creating area labels..."
gh label create "area:app" --color 0366d6 --description "Expo UI" --force || true
gh label create "area:bridge" --color 0366d6 --description "Bridge server + harnesses" --force || true
gh label create "area:shared" --color 0366d6 --description "Wire protocol" --force || true
gh label create "area:docs" --color 0366d6 --description "Documentation" --force || true
gh label create "area:loop" --color 0366d6 --description "GitHub automation" --force || true

# Priority labels
echo "🎯 Creating priority labels..."
gh label create "priority:P0" --color d73a4a --description "Critical" --force || true
gh label create "priority:P1" --color e99695 --description "High priority" --force || true
gh label create "priority:P2" --color f9d0c4 --description "Medium priority" --force || true
gh label create "priority:P3" --color fef2c0 --description "Low priority" --force || true

# Workflow labels
echo "🔄 Creating workflow labels..."
gh label create "good-first-issue" --color 7057ff --description "Good for newcomers" --force || true
gh label create "needs-discussion" --color d876e3 --description "Needs design/architecture discussion" --force || true
gh label create "work-in-progress" --color fbca04 --description "Active long-term work" --force || true
gh label create "pinned" --color 0e8a16 --description "Persistent reference" --force || true
gh label create "stale" --color eeeeee --description "Inactive issue/PR" --force || true
gh label create "claimable" --color 0e8a16 --description "Ready for autodevelop" --force || true
gh label create "claimed" --color fbca04 --description "24h autodevelop lease" --force || true
gh label create "needs-review" --color 1d76db --description "Waiting on independent review" --force || true


# Mode labels
echo "⚙️  Creating mode labels..."
gh label create "mode:unattended" --color c5def5 --description "Cloud agent contribution" --force || true
gh label create "mode:copilot" --color bfdadc --description "Human-supervised" --force || true

echo ""
echo "✓ Labels created successfully!"
echo ""
echo "View labels: https://github.com/kvnloo/dash/labels"
