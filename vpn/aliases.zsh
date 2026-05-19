# OpenVPN systemd-unit shortcuts.
#
# Configs live at /etc/openvpn/client/<name>.conf (mode 600), started via the
# openvpn-client@<name>.service template unit.

if [[ "$OSTYPE" == "linux"* ]]; then
  alias vpn-on-dev='sudo systemctl start openvpn-client@soffi-dev'
  alias vpn-on-prod='sudo systemctl start openvpn-client@soffi-prod'
  alias vpn-off='sudo systemctl stop "openvpn-client@*"'
  alias vpn-status='systemctl status "openvpn-client@*" --no-pager'
fi
