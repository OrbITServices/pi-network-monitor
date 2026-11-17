#!/usr/bin/env python3
"""Restricted root-only HTTPS configuration helper, invoked by the monitor's sudoers rule."""
import os, sys, re, subprocess, pathlib, shutil, tempfile, datetime
BASE=pathlib.Path('/etc/caddy')
CONFIG=BASE/'Caddyfile'
def run(args):
    subprocess.run(args, check=True, timeout=45)
def main():
    if os.geteuid()!=0 or len(sys.argv)!=3: raise ValueError('root and exactly two arguments required')
    mode,host=sys.argv[1:]
    if mode not in ('local','public'): raise ValueError('Unsupported certificate mode')
    if len(host)>253 or not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?',host): raise ValueError('Invalid hostname')
    if any(len(label)>63 or not label or label.startswith('-') or label.endswith('-') for label in host.split('.')): raise ValueError('Invalid DNS label')
    if mode=='local' and not host.endswith('.local'): raise ValueError('Local mode requires .local')
    if mode=='public' and (host.endswith('.local') or '.' not in host): raise ValueError('Public mode requires public FQDN')
    if not shutil.which('caddy'): raise ValueError('Install Caddy first: sudo apt install caddy')
    tls='    tls internal\n' if mode=='local' else ''
    content=f'{host} {{\n{tls}    encode zstd gzip\n    reverse_proxy 127.0.0.1:3000\n}}\n'
    BASE.mkdir(exist_ok=True)
    # Refuse to replace unrelated Caddy configurations.
    marker=BASE/'orb-monitor-managed'
    if CONFIG.exists() and not marker.exists():
        existing=CONFIG.read_text()
        # Fresh Debian/Raspberry Pi Caddy installations ship a sample static site.
        # Replace ONLY that recognisable default, never custom sites or proxies.
        default_site=(re.search(r'(?m)^\\s*:80\\s*\\{',existing) and
                      re.search(r'root\\s+\\*\\s+/usr/share/caddy',existing) and
                      re.search(r'(?m)^\\s*file_server\\s*
    with tempfile.NamedTemporaryFile(mode='w',dir=str(BASE),prefix='.orb-',delete=False) as f:
        f.write(content)
        staged=pathlib.Path(f.name)
    try:
        run(['/usr/bin/caddy','validate','--config',str(staged),'--adapter','caddyfile'])
        backup=None
        if CONFIG.exists():
            backup=BASE/('Caddyfile.orb-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S'))
            shutil.copy2(CONFIG,backup)
        os.replace(staged,CONFIG)
        try:
            run(['/usr/bin/systemctl','enable','--now','caddy'])
            run(['/usr/bin/systemctl','reload','caddy'])
        except Exception:
            if backup: shutil.copy2(backup,CONFIG)
            else: CONFIG.unlink(missing_ok=True)
            try: run(['/usr/bin/systemctl','reload','caddy'])
            except Exception: pass
            raise
        marker.touch(mode=0o600,exist_ok=True)
        print('HTTPS proxy configured. Application still listens on port 3000 until localhost binding is separately enabled.')
    finally:
        staged.unlink(missing_ok=True)
if __name__=='__main__':
    try: main()
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
,existing) and
                      'reverse_proxy' not in existing and
                      'tls ' not in existing and
                      len(existing)<10000)
        if not default_site:
            raise ValueError('Custom Caddyfile detected. It will not be overwritten; use SSH to review and migrate it.')
    with tempfile.NamedTemporaryFile(mode='w',dir=str(BASE),prefix='.orb-',delete=False) as f:
        f.write(content)
        staged=pathlib.Path(f.name)
    try:
        run(['/usr/bin/caddy','validate','--config',str(staged),'--adapter','caddyfile'])
        backup=None
        if CONFIG.exists():
            backup=BASE/('Caddyfile.orb-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S'))
            shutil.copy2(CONFIG,backup)
        os.replace(staged,CONFIG)
        try:
            run(['/usr/bin/systemctl','enable','--now','caddy'])
            run(['/usr/bin/systemctl','reload','caddy'])
        except Exception:
            if backup: shutil.copy2(backup,CONFIG)
            else: CONFIG.unlink(missing_ok=True)
            try: run(['/usr/bin/systemctl','reload','caddy'])
            except Exception: pass
            raise
        marker.touch(mode=0o600,exist_ok=True)
        print('HTTPS proxy configured. Application still listens on port 3000 until localhost binding is separately enabled.')
    finally:
        staged.unlink(missing_ok=True)
if __name__=='__main__':
    try: main()
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
