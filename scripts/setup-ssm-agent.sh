#!/bin/bash
# setup-ssm-agent.sh — Install SSM Agent for reliable remote access
#
# Run this ONCE on the EC2 instance. Can be run via:
#   - GitHub Actions deploy (add to deploy script)
#   - SSH: ssh ec2-user@<IP> 'bash -s' < scripts/setup-ssm-agent.sh
#   - EC2 User Data (on next stop/start)
#
# Why: EC2 Instance Connect uses temporary SSH keys that can fail if the
# agent isn't installed or configured. SSM Agent provides a reliable
# alternative that works through the AWS Console (Session Manager) even
# when SSH is broken. It also enables running commands via `aws ssm
# send-command` from CloudShell — useful for emergency diagnostics.
#
# Prerequisites: The EC2 instance must have an IAM role with the
# AmazonSSMManagedInstanceCore policy attached.

set -e

echo "=== Installing SSM Agent ==="

# Check if already installed and running
if systemctl is-active --quiet amazon-ssm-agent 2>/dev/null; then
    echo "SSM Agent already running:"
    sudo systemctl status amazon-ssm-agent --no-pager | head -5
    exit 0
fi

# Install SSM Agent (Amazon Linux 2023)
if command -v dnf &>/dev/null; then
    sudo dnf install -y amazon-ssm-agent
elif command -v yum &>/dev/null; then
    sudo yum install -y amazon-ssm-agent
else
    echo "ERROR: Neither dnf nor yum found — cannot install SSM Agent"
    exit 1
fi

# Enable and start
sudo systemctl enable amazon-ssm-agent
sudo systemctl start amazon-ssm-agent

echo ""
echo "=== SSM Agent installed ==="
sudo systemctl status amazon-ssm-agent --no-pager | head -5
echo ""
echo "Next steps:"
echo "  1. Attach 'AmazonSSMManagedInstanceCore' policy to the EC2 IAM role"
echo "  2. Verify in AWS Console: Systems Manager > Fleet Manager"
echo "  3. Connect via: AWS Console > EC2 > Connect > Session Manager"
echo ""
echo "Done. SSM Agent will start automatically on reboot."
