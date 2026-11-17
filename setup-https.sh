#!/usr/bin/env bash
# Optional HTTPS setup. Run on the Pi as its normal sudo-enabled account.
set -Eeuo pipefail
if [ "$(id -u)" -eq 0 ]; then echo "Run as your normal account, not root."; exit 1; fi
sudo -v
hostname_short="$(hostname -s)"
echo "HTTPS mode: 1) .local/internal CA  2) Public domain/Let's Encrypt HTTP-01  3) Existing PEM certificate"
read -r -p "Choose [1/2/3]: " mode
case "$mode" in
  1)
    host="${hostname_short}.local"
    tls_line="tls internal"
    ;;
  2)
    read -r -p "Domain name (e.g. monitor.example.com): " host
    if ! [[ "$host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || [[ "$host" == *.local ]]; then echo "Invalid public hostname"; exit 1; fi
    echo "Let's Encrypt HTTP-01 requires public DNS pointing to this Pi and inbound port 80 (and 443 for access)."
    echo "For an internal-only domain use DNS-01 with a separately configured Caddy DNS provider plugin; this script does not configure DNS-01."
    read -r -p "Is HTTP-01 reachability configured? [y/N]: " answer
    [[ "${answer,,}" == "y" ]] || exit 1
    tls_line=""
    ;;
  3)
    read -r -p "Hostname matching your certificate: " host
    if ! [[ "$host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then echo "Invalid hostname"; exit 1; fi
    read -r -p "Absolute path to PEM certificate/fullchain: " cert
    read -r -p "Absolute path to PEM private key: " key
    [[ "$cert" == /* && "$key" == /* && -f "$cert" && -f "$key" ]] || { echo "Certificate/key not found"; exit 1; }
    sudo openssl x509 -in "$cert" -noout >/dev/null
    sudo openssl pkey -in "$key" -noout >/dev/null
    cert_pub="$(sudo openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)"
    key_pub="$(sudo openssl pkey -in "$key" -pubout -outform DER | sha256sum | cut -d' ' -f1)"
    [[ "$cert_pub" == "$key_pub" ]] || { echo "Certificate and key do not match"; exit 1; }
    tls_line="tls $cert $key"
    ;;
  *) echo "Invalid selection"; exit 1;;
esac
echo "Installing Caddy..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
sudo mkdir -p /etc/caddy/orb-monitor
sudo tee /etc/caddy/orb-monitor/Caddyfile >/dev/null <<EOF
$host {
    $tls_line
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
# Validate before replacing any existing Caddy configuration.
sudo caddy validate --config /etc/caddy/orb-monitor/Caddyfile --adapter caddyfile
if [ -f /etc/caddy/Caddyfile ]; then
  sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.orb-backup-$(date +%Y%m%d%H%M%S)"
fi
sudo cp /etc/caddy/orb-monitor/Caddyfile /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
if ! systemctl is-active --quiet caddy; then echo "Caddy failed. Existing Node port 3000 remains accessible."; exit 1; fi
# Only restrict Node after Caddy has started successfully.
sudo mkdir -p /etc/systemd/system/pi-network-monitor.service.d
printf '[Service]\nEnvironment=HOST=127.0.0.1\n' | sudo tee /etc/systemd/system/pi-network-monitor.service.d/https.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart pi-network-monitor
echo "HTTPS configured: https://$host"
if [ "$mode" = 1 ]; then
  echo "Internal CA certificate (public only): /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
  echo "Copy it securely to each admin PC and import into the trusted root certificate store."
fi
echo "If HTTPS is not reachable, inspect: sudo journalctl -u caddy -n 60 --no-pager"
