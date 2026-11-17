<?php
/**
 * Orb Monitor Hub: custom alert recipients and read-only shareable wallboard.
 * The wallboard token is a bearer secret. Keep it private.
 */
if (!defined('ABSPATH')) { exit; }

final class Orb_Monitor_Sharing {
    const OPTION_EMAILS = 'orbmon_alert_recipients';
    const OPTION_SHARE = 'orbmon_share_hash';
    const OPTION_EXPIRES = 'orbmon_share_expires';

    public static function init() {
        add_action('admin_menu', function () {
            add_submenu_page('orb-monitor', 'Alerts & Wallboard', 'Alerts & Wallboard', 'manage_options',
                'orb-monitor-sharing', array(__CLASS__, 'settings_page'));
        });
        add_action('template_redirect', array(__CLASS__, 'maybe_wallboard'), 0);
    }

    public static function recipients() {
        $raw = (string)get_option(self::OPTION_EMAILS, '');
        $emails = array();
        foreach (preg_split('/[;,\\r\\n]+/', $raw) as $entry) {
            $email = sanitize_email(trim($entry));
            if ($email && is_email($email)) { $emails[strtolower($email)] = $email; }
        }
        return array_values($emails);
    }

    public static function notify($subject, $body) {
        $recipients = self::recipients();
        if ($recipients) {
            wp_mail($recipients, $subject, $body);
        }
    }

    public static function settings_page() {
        if (!current_user_can('manage_options')) { return; }
        $notice = '';
        $new_url = '';
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['orbmon_share_action'])) {
            check_admin_referer('orbmon_sharing');
            $action = sanitize_key(wp_unslash($_POST['orbmon_share_action']));
            if ($action === 'save') {
                $raw = sanitize_textarea_field(wp_unslash($_POST['recipients'] ?? ''));
                $valid = array();
                $invalid = array();
                foreach (preg_split('/[;,\\r\\n]+/', $raw) as $entry) {
                    $entry = trim($entry);
                    if (!$entry) { continue; }
                    $email = sanitize_email($entry);
                    if ($email && is_email($email)) { $valid[strtolower($email)] = $email; }
                    else { $invalid[] = $entry; }
                }
                if ($invalid) {
                    $notice = '<div class="notice notice-error"><p>Invalid email addresses. Nothing saved.</p></div>';
                } else {
                    update_option(self::OPTION_EMAILS, implode("\n", array_values($valid)), false);
                    $notice = '<div class="notice notice-success"><p>Alert recipients saved.</p></div>';
                }
            } elseif ($action === 'generate') {
                $days = min(365, max(1, absint($_POST['days'] ?? 30)));
                $token = bin2hex(random_bytes(32));
                update_option(self::OPTION_SHARE, hash('sha256', $token), false);
                update_option(self::OPTION_EXPIRES, time() + ($days * DAY_IN_SECONDS), false);
                $new_url = add_query_arg('orbmon_share', rawurlencode($token), home_url('/'));
                $notice = '<div class="notice notice-success"><p>New link generated. Previous link is now invalid. Copy this link now; it cannot be recovered.</p></div>';
            } elseif ($action === 'revoke') {
                delete_option(self::OPTION_SHARE);
                delete_option(self::OPTION_EXPIRES);
                $notice = '<div class="notice notice-success"><p>Wallboard link revoked.</p></div>';
            }
        }
        $expires = (int)get_option(self::OPTION_EXPIRES, 0);
        $active = (bool)get_option(self::OPTION_SHARE, '') && $expires > time();
        echo '<div class="wrap"><h1>Orb Monitor: Alerts &amp; Wallboard</h1>' . $notice;
        echo '<p>Device status-change emails are sent to these addresses when email notifications are enabled on the main Orb Monitor page. Separate addresses with commas or new lines.</p>';
        echo '<form method="post">'; wp_nonce_field('orbmon_sharing');
        echo '<input type="hidden" name="orbmon_share_action" value="save">';
        echo '<textarea name="recipients" rows="5" cols="65" class="large-text" placeholder="alerts@example.com">' .
            esc_textarea(get_option(self::OPTION_EMAILS, '')) . '</textarea><p><button class="button button-primary">Save recipients</button></p></form>';
        echo '<hr><h2>Private read-only wallboard</h2>';
        echo '<p>Anyone possessing the link can see site and device statuses without logging into WordPress. No administration or API keys are exposed. Share only with trusted people.</p>';
        if ($active) {
            echo '<p><strong>Current link:</strong> Active until ' . esc_html(gmdate('Y-m-d H:i', $expires)) . ' UTC. The URL cannot be shown again; generate a replacement if lost.</p>';
        } else {
            echo '<p><strong>Current link:</strong> Not active.</p>';
        }
        if ($new_url) {
            echo '<p><strong>Copy the new private link now:</strong></p><p><input readonly class="large-text" onclick="this.select()" value="' . esc_attr($new_url) . '"></p>';
        }
        echo '<form method="post">'; wp_nonce_field('orbmon_sharing');
        echo '<input type="hidden" name="orbmon_share_action" value="generate"><label>Link expiry (days) <input type="number" name="days" min="1" max="365" value="30"></label> <button class="button button-primary">Generate / rotate link</button></form>';
        echo '<form method="post" style="margin-top:1em">'; wp_nonce_field('orbmon_sharing');
        echo '<input type="hidden" name="orbmon_share_action" value="revoke"><button class="button" onclick="return confirm(\'Revoke the current wallboard link?\')">Revoke link</button></form>';
        echo '</div>';
    }

    public static function maybe_wallboard() {
        if (!isset($_GET['orbmon_share'])) { return; }
        $token = sanitize_text_field(wp_unslash($_GET['orbmon_share']));
        $hash = (string)get_option(self::OPTION_SHARE, '');
        $expires = (int)get_option(self::OPTION_EXPIRES, 0);
        if (!preg_match('/^[a-f0-9]{64}$/D', $token) || !$hash || $expires <= time() ||
            !hash_equals($hash, hash('sha256', $token))) {
            status_header(404);
            nocache_headers();
            exit('Wallboard link is invalid or expired.');
        }
        nocache_headers();
        header('X-Robots-Tag: noindex, nofollow, noarchive', true);
        header('Referrer-Policy: no-referrer', true);
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", true);
        self::render_wallboard();
        exit;
    }

    private static function render_wallboard() {
        global $wpdb;
        $sites = $wpdb->get_results('SELECT id, name, last_report FROM ' . $wpdb->prefix . 'orbmon_sites ORDER BY name');
        $devices = $wpdb->get_results('SELECT site_id, name, ip, status, monitored, last_checked FROM ' . $wpdb->prefix . 'orbmon_devices ORDER BY name');
        $site_map = array();
        foreach ($sites as $site) { $site_map[(int)$site->id] = $site; }
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="30"><title>Orb Monitor Wallboard</title>';
        echo '<style>body{background:#0b1324;color:#e9f1ff;font:16px system-ui,Arial;margin:0;padding:2rem}h1{margin:0 0 1rem}h2{margin:1.5rem 0 .5rem}.site{background:#17233a;border-radius:12px;padding:1rem;margin:1rem 0}.status{display:inline-block;border-radius:30px;padding:.2rem .7rem;font-weight:700}.online{background:#14532d;color:#dcfce7}.offline{background:#7f1d1d;color:#fee2e2}.unknown{background:#334155;color:#e2e8f0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #334155}small{color:#94a3b8}a{color:inherit}</style></head><body>';
        echo '<h1>Orb Monitor Wallboard</h1><small>Read-only · refreshes every 30 seconds · UTC ' . esc_html(gmdate('Y-m-d H:i:s')) . '</small>';
        foreach ($sites as $site) {
            $last = $site->last_report ? strtotime($site->last_report . ' UTC') : false;
            $stale = !$last || time() - $last > 180;
            echo '<section class="site"><h2>' . esc_html($site->name) . ' <span class="status ' . ($stale ? 'offline' : 'online') . '">' . ($stale ? 'No recent heartbeat' : 'Reporting') . '</span></h2>';
            echo '<table><thead><tr><th>Device</th><th>IP</th><th>Status</th><th>Last checked</th></tr></thead><tbody>';
            foreach ($devices as $device) {
                if ((int)$device->site_id !== (int)$site->id || !$device->monitored) { continue; }
                $status = in_array($device->status, array('online','offline'), true) ? $device->status : 'unknown';
                echo '<tr><td>' . esc_html($device->name) . '</td><td>' . esc_html($device->ip) . '</td><td><span class="status ' . esc_attr($status) . '">' . esc_html(ucfirst($status)) . '</span></td><td>' . esc_html($device->last_checked) . '</td></tr>';
            }
            echo '</tbody></table></section>';
        }
        echo '</body></html>';
    }
}
Orb_Monitor_Sharing::init();
