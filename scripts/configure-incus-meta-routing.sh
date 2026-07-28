#!/bin/sh
set -eu

vm_cidr=${ZAW_VM_CIDR:-10.99.0.0/24}
vm_bridge=${ZAW_VM_BRIDGE:-incusbr0}
meta_interface=${ZAW_META_INTERFACE:-Meta}
meta_table=${ZAW_META_ROUTE_TABLE:-2022}

if [ "$(id -u)" -ne 0 ]; then
  echo "configure-incus-meta-routing must run as root" >&2
  exit 1
fi

ip link show "$vm_bridge" >/dev/null
ip link show "$meta_interface" >/dev/null
ip route show table "$meta_table" | grep -q .

if ! ip rule show | grep -Fq "from $vm_cidr to $vm_cidr lookup main"; then
  ip rule add priority 8998 from "$vm_cidr" to "$vm_cidr" lookup main
fi
if ! ip rule show | grep -Fq "from $vm_cidr lookup $meta_table"; then
  ip rule add priority 8999 from "$vm_cidr" lookup "$meta_table"
fi

# Docker's later FORWARD base chain can drop traffic already accepted by Incus.
iptables -C DOCKER-USER -i "$vm_bridge" -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -i "$vm_bridge" -j ACCEPT
iptables -C DOCKER-USER -o "$vm_bridge" \
  -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -o "$vm_bridge" \
    -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
