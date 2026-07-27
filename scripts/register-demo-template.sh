#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
repository="$root/.data/demo-template"
server_url=${ZAW_SERVER_URL:-http://127.0.0.1:8080}

mkdir -p "$repository"
cp "$root/examples/templates/docker-workspace/main.tf" "$repository/main.tf"
cp "$root/examples/templates/docker-workspace/variables.tf" "$repository/variables.tf"

if [ ! -d "$repository/.git" ]; then
  git -C "$repository" init -q
  git -C "$repository" config user.name "Zaw Demo"
  git -C "$repository" config user.email "demo@zaw.local"
fi

git -C "$repository" add main.tf variables.tf
if ! git -C "$repository" diff --cached --quiet; then
  git -C "$repository" commit -qm "Update demo workspace template"
fi

templates=$(curl -fsS "$server_url/api/v1/templates")
existing_id=$(printf '%s' "$templates" | node -e '
  let body = "";
  process.stdin.on("data", chunk => body += chunk);
  process.stdin.on("end", () => {
    const item = JSON.parse(body).find(template => template.name === "Docker Demo Workspace");
    if (item) process.stdout.write(item.id);
  });
')
if [ -n "$existing_id" ]; then
  printf 'Demo template already registered: %s\n' "$existing_id"
  exit 0
fi

commit=$(git -C "$repository" rev-parse HEAD)
payload=$(node -e '
  process.stdout.write(JSON.stringify({
    name: "Docker Demo Workspace",
    description: "Minimal Alpine container for testing workspace provisioning.",
    source: {
      kind: "git",
      url: process.argv[1],
      commit: process.argv[2]
    }
  }));
' "$repository" "$commit")

curl -fsS \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  "$server_url/api/v1/templates"
printf '\n'