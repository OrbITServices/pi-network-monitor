#!/usr/bin/env python3
"""Restricted, read-only privileged security inspection. No arguments accepted."""
import json
import os
import subprocess
import sys

KEYS = ('permitrootlogin', 'passwordauthentication', 'kbdinteractiveauthentication', 'x11forwarding')

def run(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=8, check=False)
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None

def main():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        sys.exit(2)
    ssh = run(['/usr/sbin/sshd', '-T'])
    values = {}
    if ssh is not None:
        for line in ssh.splitlines():
            key, _, value = line.partition(' ')
            if key in KEYS:
                values[key] = value.strip()
    ufw = run(['/usr/sbin/ufw', 'status', 'verbose'])
    state = 'unknown'
    policy = None
    if ufw is not None:
        for line in ufw.splitlines():
            if line.startswith('Status: '):
                state = line.partition(': ')[2].strip().lower()
            if line.startswith('Default: '):
                policy = line.partition(': ')[2].strip()
    print(json.dumps({'ssh': values, 'ssh_ok': ssh is not None,
                      'ufw': {'status': state, 'default': policy}}))

if __name__ == '__main__':
    main()
