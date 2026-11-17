<?php
/**
 * Plugin Name: Orb Monitor Hub
 * Description: Receives network monitoring snapshots from Raspberry Pi agents and shows a central dashboard.
 * Version: 0.2.2
 * Requires PHP: 7.4
 * Author: Orb IT Services
 * Text Domain: orb-monitor-hub
 */
if (!defined('ABSPATH')) { exit; }

final class Orb_Monitor_Hub {
    const VERSION = '0.2.2';
    const API_NS = 'orb-monitor/v1';
    private static function table($name) { global $wpdb; return $wpdb->prefix . 'orbmon_' . $name; }
    public static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        dbDelta('CREATE TABLE ' . self::table('sites') . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(120) NOT NULL,
            site_key varchar(80) NOT NULL,
            token_hash char(64) NOT NULL,
            last_report datetime DEFAULT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY site_key (site_key)
        ) $charset;");
        dbDelta('CREATE TABLE ' . self::table('devices') . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            site_id bigint(20) unsigned NOT NULL,
            device_key varchar(128) NOT NULL,
            name varchar(160) NOT NULL,
            ip varchar(80) NOT NULL DEFAULT '',
            mac varchar(32) NOT NULL DEFAULT '',
            hostname varchar(255) NOT NULL DEFAULT '',
            status varchar(16) NOT NULL DEFAULT 'unknown',
            monitored tinyint(1) NOT NULL DEFAULT 1,
            last_checked varchar(60) NOT NULL DEFAULT '',
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY site_device (site_id,device_key),
            KEY site_id (site_id)
        ) $charset;");
        dbDelta('CREATE TABLE ' . self::table('events') . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            site_id bigint(20) unsigned NOT NULL,
            device_key varchar(128) NOT NULL,
            device_name varchar(160) NOT NULL,
            old_status varchar(16) NOT NULL,
            new_status varchar(16) NOT NULL,
            occurred_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY site_time (site_id,occurred_at)
        ) $charset;");
    }
    public static function init() {
        add_action('rest_api_init', function() {
            register_rest_route(self::API_NS, '/report', array(
                'methods' => 'POST',
                'callback' => array(__CLASS__, 'receive'),
                'permission_callback' => '__return_true',
            ));
        });
        add_action('admin_menu', function() {
            add_menu_page('Orb Monitor', 'Orb Monitor', 'manage_options', 'orb-monitor', array(__CLASS__, 'admin_page'), 'dashicons-networking', 65);
        });
        // Register both admin pages together, with the same capability.
        add_action('admin_menu', function() {
            add_submenu_page('orb-monitor', 'Dashboard', 'Dashboard', 'manage_options',
                'orb-monitor', array(__CLASS__, 'admin_page'));
            add_submenu_page('orb-monitor', 'Alerts & Wallboard', 'Alerts & Wallboard', 'manage_options',
                'orb-monitor-sharing', array('Orb_Monitor_Sharing', 'settings_page'));
        }, 20);
        // Some sites rewrite custom admin menu URLs to /wp-admin/{slug}.
        // Restore WordPress's canonical admin.php?page=... links after menus are rendered.
        add_action('admin_footer', function() {
            if (!current_user_can('manage_options')) { return; }
            $dashboard = admin_url('admin.php?page=orb-monitor');
            $sharing = admin_url('admin.php?page=orb-monitor-sharing');
            echo '<script>(function(){var links=' . wp_json_encode(array(
                'orb-monitor' => $dashboard, 'orb-monitor-sharing' => $sharing
            )) . ';document.querySelectorAll("#adminmenu a").forEach(function(a){var href=a.getAttribute("href")||"";Object.keys(links).forEach(function(slug){if(href===slug||href.endsWith("/"+slug)||href.indexOf("page="+slug)!==-1){a.setAttribute("href",links[slug]);}});});})();</script>';
        });
        add_shortcode('orb_monitor_dashboard', array(__CLASS__, 'shortcode'));
    }
    private static function valid_status($value) {
        $v = strtolower(trim((string)$value));
        if (in_array($v, array('up', 'online', 'ok', 'healthy'), true)) { return 'online'; }
        if (in_array($v, array('down', 'offline', 'failed', 'unreachable'), true)) { return 'offline'; }
        return 'unknown';
    }
    public static function receive($request) {
        global $wpdb;
        $site_key = sanitize_key((string)$request->get_param('site_key'));
        $token = (string)$request->get_header('x-orb-monitor-key');
        if (!$site_key || strlen($token) < 32 || strlen($token) > 256) {
            return new WP_Error('orb_auth', 'Invalid credentials', array('status' => 401));
        }
        $site = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table('sites') . ' WHERE site_key = %s', $site_key));
        if (!$site || !hash_equals($site->token_hash, hash('sha256', $token))) {
            return new WP_Error('orb_auth', 'Invalid credentials', array('status' => 401));
        }
        $devices = $request->get_param('devices');
        if (!is_array($devices) || count($devices) > 500) {
            return new WP_Error('orb_payload', 'devices must be an array of up to 500 entries', array('status' => 400));
        }
        $now = current_time('mysql', true);
        $dt = self::table('devices'); $et = self::table('events');
        $changes = 0;
        foreach ($devices as $item) {
            if (!is_array($item)) { continue; }
            $key = substr(sanitize_text_field((string)($item['key'] ?? '')), 0, 128);
            if (!$key) { continue; }
            $name = substr(sanitize_text_field((string)($item['name'] ?? $key)), 0, 160);
            $ip = substr(sanitize_text_field((string)($item['ip'] ?? '')), 0, 80);
            $mac = substr(sanitize_text_field((string)($item['mac'] ?? '')), 0, 32);
            $hostname = substr(sanitize_text_field((string)($item['hostname'] ?? '')), 0, 255);
            $status = self::valid_status($item['status'] ?? 'unknown');
            $monitored = !empty($item['monitored']) ? 1 : 0;
            $checked = substr(sanitize_text_field((string)($item['last_checked'] ?? '')), 0, 60);
            $old = $wpdb->get_row($wpdb->prepare("SELECT status FROM $dt WHERE site_id = %d AND device_key = %s", $site->id, $key));
            $data = array('site_id'=>(int)$site->id, 'device_key'=>$key, 'name'=>$name, 'ip'=>$ip, 'mac'=>$mac,
                'hostname'=>$hostname, 'status'=>$status, 'monitored'=>$monitored, 'last_checked'=>$checked, 'updated_at'=>$now);
            $formats = array('%d','%s','%s','%s','%s','%s','%s','%d','%s','%s');
            if ($old) {
                $wpdb->update($dt, $data, array('site_id'=>$site->id, 'device_key'=>$key), $formats, array('%d','%s'));
            } else {
                $wpdb->insert($dt, $data, $formats);
            }
            if ($old && $old->status !== $status && $monitored && in_array($status, array('online','offline'), true)) {
                $wpdb->insert($et, array('site_id'=>(int)$site->id, 'device_key'=>$key, 'device_name'=>$name,
                    'old_status'=>$old->status, 'new_status'=>$status, 'occurred_at'=>$now), array('%d','%s','%s','%s','%s','%s'));
                $changes++;
                if (get_option('orbmon_email_alerts') === '1') {
                    Orb_Monitor_Sharing::notify('[Orb Monitor] ' . $site->name . ': ' . $name . ' ' . $status,
                        'Site: ' . $site->name . "\nDevice: " . $name . "\nPrevious: " . $old->status . "\nCurrent: " . $status . "\nIP: " . $ip);
                }
            }
        }
        $wpdb->update(self::table('sites'), array('last_report'=>$now), array('id'=>$site->id), array('%s'), array('%d'));
        return rest_ensure_response(array('ok'=>true, 'received'=>count($devices), 'changes'=>$changes));
    }
    private static function handle_admin_post() {
        global $wpdb;
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_POST['orbmon_action'])) { return ''; }
        check_admin_referer('orbmon_admin');
        $action = sanitize_key(wp_unslash($_POST['orbmon_action']));
        if ($action === 'add_site') {
            $name = substr(sanitize_text_field(wp_unslash($_POST['site_name'] ?? '')), 0, 120);
            $key = sanitize_key(wp_unslash($_POST['site_key'] ?? ''));
            if (!$name) { return '<div class="notice notice-error"><p>Enter a site name.</p></div>'; }
            if (!$key) { $key = 'pi-' . bin2hex(random_bytes(8)); }
            $token = bin2hex(random_bytes(32));
            $ok = $wpdb->insert(self::table('sites'), array('name'=>$name, 'site_key'=>$key,
                'token_hash'=>hash('sha256', $token), 'created_at'=>current_time('mysql', true)), array('%s','%s','%s','%s'));
            if (!$ok) { return '<div class="notice notice-error"><p>Site key already exists or database error.</p></div>'; }
            return '<div class="notice notice-success"><p><strong>Site created. Copy this API key now; it cannot be displayed again.</strong></p><p><code style="user-select:all">' . esc_html($token) . '</code></p><p>Site key: <code>' . esc_html($key) . '</code></p></div>';
        }
        if ($action === 'rotate_key') {
            $id = absint($_POST['site_id'] ?? 0);
            $token = bin2hex(random_bytes(32));
            $updated = $wpdb->update(self::table('sites'), array('token_hash'=>hash('sha256',$token)), array('id'=>$id), array('%s'), array('%d'));
            return $updated ? '<div class="notice notice-success"><p><strong>New API key (copy now):</strong> <code style="user-select:all">' . esc_html($token) . '</code></p></div>' : '<div class="notice notice-error"><p>Could not rotate key.</p></div>';
        }
        if ($action === 'save_settings') {
            update_option('orbmon_email_alerts', !empty($_POST['email_alerts']) ? '1' : '0');
            return '<div class="notice notice-success"><p>Settings saved.</p></div>';
        }
        return '';
    }
    public static function admin_page() {
        if (!current_user_can('manage_options')) { return; }
        global $wpdb;
        $notice = self::handle_admin_post();
        $sites = $wpdb->get_results('SELECT * FROM ' . self::table('sites') . ' ORDER BY name');
        $devices = $wpdb->get_results('SELECT * FROM ' . self::table('devices') . ' ORDER BY site_id, name');
        $events = $wpdb->get_results('SELECT e.*, s.name AS site_name FROM ' . self::table('events') . ' e JOIN ' . self::table('sites') . ' s ON s.id=e.site_id ORDER BY e.id DESC LIMIT 50');
        echo '<div class="wrap"><h1>Orb Monitor Hub</h1>' . $notice;
        echo '<p><a class="button button-secondary" href="' . esc_url(admin_url('admin.php?page=orb-monitor-sharing')) . '">Alerts &amp; Wallboard settings</a></p>';
        echo '<p>Pi reporting endpoint: <code>' . esc_html(rest_url(self::API_NS . '/report')) . '</code></p>';
        echo '<h2>Sites</h2><table class="widefat striped"><thead><tr><th>Site</th><th>Site key</th><th>Heartbeat</th><th>Devices</th><th>API key</th></tr></thead><tbody>';
        foreach ($sites as $site) {
            $last = $site->last_report ? strtotime($site->last_report . ' UTC') : false;
            $health = !$last ? 'Never reported' : ((time() - $last > 180) ? 'Not reporting (over 3 min)' : 'Reporting');
            $count = 0; foreach ($devices as $d) { if ((int)$d->site_id === (int)$site->id) { $count++; } }
            echo '<tr><td>' . esc_html($site->name) . '</td><td><code>' . esc_html($site->site_key) . '</code></td><td>' . esc_html($health) . ($last ? ' · ' . esc_html(human_time_diff($last, time())) . ' ago' : '') . '</td><td>' . esc_html($count) . '</td><td><form method="post">';
            wp_nonce_field('orbmon_admin');
            echo '<input type="hidden" name="orbmon_action" value="rotate_key"><input type="hidden" name="site_id" value="' . esc_attr($site->id) . '"><button class="button" onclick="return confirm(\'Rotate key? The Pi will stop reporting until its key is updated.\')">Rotate key</button></form></td></tr>';
        }
        echo '</tbody></table><h2>Devices</h2><table class="widefat striped"><thead><tr><th>Site</th><th>Device</th><th>IP</th><th>MAC</th><th>Status</th><th>Monitored</th></tr></thead><tbody>';
        foreach ($devices as $d) {
            $site_name = ''; foreach ($sites as $s) { if ((int)$s->id === (int)$d->site_id) { $site_name=$s->name; break; } }
            echo '<tr><td>' . esc_html($site_name) . '</td><td>' . esc_html($d->name) . '</td><td>' . esc_html($d->ip) . '</td><td>' . esc_html($d->mac) . '</td><td><strong>' . esc_html(ucfirst($d->status)) . '</strong></td><td>' . ($d->monitored ? 'Yes' : 'No') . '</td></tr>';
        }
        echo '</tbody></table><h2>Latest status changes</h2><table class="widefat striped"><thead><tr><th>Time (UTC)</th><th>Site</th><th>Device</th><th>Change</th></tr></thead><tbody>';
        foreach ($events as $e) {
            echo '<tr><td>' . esc_html($e->occurred_at) . '</td><td>' . esc_html($e->site_name) . '</td><td>' . esc_html($e->device_name) . '</td><td>' . esc_html($e->old_status . ' → ' . $e->new_status) . '</td></tr>';
        }
        echo '</tbody></table><h2>Add a Pi site</h2><form method="post">';
        wp_nonce_field('orbmon_admin');
        echo '<input type="hidden" name="orbmon_action" value="add_site"><p><label>Site name <input type="text" name="site_name" required placeholder="Client office"></label> <label>Site key <input type="text" id="orbmon-site-key" name="site_key" pattern="[a-z0-9_-]+" placeholder="Auto-generated if blank"> <button type="button" class="button" onclick="(function(){var b=new Uint8Array(8);crypto.getRandomValues(b);document.getElementById(\'orbmon-site-key\').value=\'pi-\'+Array.from(b,x=>x.toString(16).padStart(2,\'0\')).join(\'\')})()">Generate Site Key</button></label> <button class="button button-primary">Create site and API key</button></p><p class="description">Leave the site key blank to generate one automatically. The API key is always generated securely on the server and displayed only once.</p></form>';
        echo '<h2>Notifications</h2><form method="post">'; wp_nonce_field('orbmon_admin');
        echo '<input type="hidden" name="orbmon_action" value="save_settings"><label><input type="checkbox" name="email_alerts" value="1" ' . checked(get_option('orbmon_email_alerts'), '1', false) . '> Email configured recipients on device status changes</label> <button class="button">Save</button></form>';
        echo '<p>Only WordPress administrators can see this dashboard. The optional shortcode <code>[orb_monitor_dashboard]</code> is also administrator-only.</p></div>';
    }
    public static function shortcode() {
        if (!current_user_can('manage_options')) { return '<p>Monitoring dashboard restricted to administrators.</p>'; }
        ob_start(); self::admin_page(); return ob_get_clean();
    }
}
register_activation_hook(__FILE__, array('Orb_Monitor_Hub', 'activate'));
require_once __DIR__ . '/includes/sharing.php';
Orb_Monitor_Hub::init();
