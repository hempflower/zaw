#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_directory="$repository_root/examples/templates/incus-ubuntu-24"
workspace_id="m7-verify-$(date -u +%Y%m%d%H%M%S)-$$"
instance_name="zaw-$workspace_id"
volume_name="$instance_name-workspace"

case "$workspace_id" in
  m7-verify-*) ;;
  *)
    echo "refusing to operate on an unexpected workspace name" >&2
    exit 1
    ;;
esac

work_directory="$(mktemp -d)"
created=false

cleanup() {
  if [[ "$created" == true ]]; then
    terraform -chdir="$work_directory" destroy -auto-approve \
      -var="workspace_id=$workspace_id" \
      -var="zaw_workspace_id=$workspace_id" \
      -var="zaw_workspace_running=true" \
      -var="zaw_server_url=ws://10.99.0.1:8080" \
      -var="zaw_copilot_cli_path=/bin/true" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work_directory"
}
trap cleanup EXIT

if incus info "$instance_name" >/dev/null 2>&1; then
  echo "isolated verification instance already exists: $instance_name" >&2
  exit 1
fi

cp -a "$template_directory/." "$work_directory/"
terraform -chdir="$work_directory" init -input=false \
  -backend-config="path=$work_directory/terraform.tfstate"

common_variables=(
  -var="workspace_id=$workspace_id"
  -var="zaw_workspace_id=$workspace_id"
  -var="zaw_server_url=ws://10.99.0.1:8080"
  -var="zaw_copilot_cli_path=/bin/true"
)

terraform -chdir="$work_directory" apply -auto-approve \
  "${common_variables[@]}" -var="zaw_workspace_running=true"
created=true

original_uuid="$(incus config get "$instance_name" volatile.uuid)"
test -n "$original_uuid"
test "$(incus info "$instance_name" | awk '/^Status:/ {print tolower($2)}')" = "running"

terraform -chdir="$work_directory" plan -out=stop.tfplan \
  "${common_variables[@]}" -var="zaw_workspace_running=false"
terraform -chdir="$work_directory" show -json stop.tfplan >"$work_directory/stop.json"
if jq -e '.resource_changes[] | select(.change.actions | index("delete"))' \
  "$work_directory/stop.json" >/dev/null; then
  echo "stop plan unexpectedly deletes a resource" >&2
  exit 1
fi

terraform -chdir="$work_directory" apply -auto-approve stop.tfplan
test "$(incus info "$instance_name" | awk '/^Status:/ {print tolower($2)}')" = "stopped"
test "$(incus config get "$instance_name" volatile.uuid)" = "$original_uuid"
terraform -chdir="$work_directory" state show incus_instance.workspace >/dev/null
terraform -chdir="$work_directory" state show incus_storage_volume.workspace_data >/dev/null

terraform -chdir="$work_directory" apply -auto-approve \
  "${common_variables[@]}" -var="zaw_workspace_running=true"
test "$(incus info "$instance_name" | awk '/^Status:/ {print tolower($2)}')" = "running"
test "$(incus config get "$instance_name" volatile.uuid)" = "$original_uuid"

printf '%s' 'm7-verification-token-not-a-real-credential' >"$work_directory/token"
incus file push "$work_directory/token" \
  "$instance_name/etc/zaw/registration.token" --mode=0600
test "$(incus exec "$instance_name" -- stat -c %a /usr/local/bin/zaw)" = "755"
test "$(incus exec "$instance_name" -- stat -c %a /etc/zaw/agent.env)" = "600"
test "$(incus exec "$instance_name" -- stat -c %a /etc/zaw/registration.token)" = "600"
if terraform -chdir="$work_directory" state pull | grep -Fq \
  'm7-verification-token-not-a-real-credential'; then
  echo "Agent Host registration credential leaked into Terraform State" >&2
  exit 1
fi

terraform -chdir="$work_directory" destroy -auto-approve \
  "${common_variables[@]}" -var="zaw_workspace_running=true"
created=false

if incus info "$instance_name" >/dev/null 2>&1; then
  echo "verification instance remained after delete" >&2
  exit 1
fi
if incus storage volume show default "$volume_name" >/dev/null 2>&1; then
  echo "verification volume remained after delete" >&2
  exit 1
fi

echo "M7 Incus lifecycle passed for $instance_name (UUID $original_uuid)"
