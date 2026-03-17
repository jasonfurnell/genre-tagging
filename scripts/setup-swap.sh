#!/bin/bash
# setup-swap.sh — One-time swap setup for t3.micro (1GB RAM)
#
# Run this ONCE on the EC2 instance via SSH:
#   ssh ec2-user@<IP> 'bash -s' < scripts/setup-swap.sh
#
# Why: t3.micro has 1GB RAM. Docker + nginx + the Flask app + deploy
# canary can exceed 1GB, causing the OOM killer to step in and crash
# the container or even Docker itself. Swap provides an overflow buffer
# so the system can survive temporary memory spikes (at the cost of
# slower performance during swapping, which is fine for deploys).

set -e

echo "=== Setting up 1GB swap file ==="

# Skip if swap already exists
if swapon --show | grep -q '/swapfile'; then
    echo "Swap already configured:"
    swapon --show
    free -m
    exit 0
fi

# Create 1GB swap file
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent across reboots
if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
fi

# Tune swappiness — only swap when memory is genuinely pressured.
# Default is 60; 10 means "prefer RAM, use swap as last resort".
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf

echo ""
echo "=== Swap configured ==="
swapon --show
free -m
echo ""
echo "Done. Swap will persist across reboots."
