const fs=require('fs');
const os=require('os');
const https=require('https');
const {execFile}=require('child_process');
const {promisify}=require('util');
const {getSettings}=require('./db');
const run=promisify(execFile);
const read=p=>{try{return fs.readFileSync(p,'utf8')}catch{return ''}};
async function cmd(file,args=[],timeout=8000){try{return (await run(file,args,{timeout,maxBuffer:200000})).stdout.trim()}catch{return null}}
const check=(id,group,label,level,detail,advice)=>({id,group,label,level,detail:String(detail||'Not available'),advice:advice||''});
async function scan(){
 const checks=[],add=(...a)=>checks.push(check(...a));
 const settings=getSettings();
 // sshd -T may require elevated permissions to inspect host keys.
 // Preserve the actual failure rather than reporting four unexplained unknowns.
 let sshError='';
 let ssh=null;
 try { ssh=(await run('/usr/sbin/sshd',['-T'],{timeout:8000,maxBuffer:200000})).stdout.trim(); }
 catch(e) { sshError=(e.stderr||e.message||'sshd -T failed').trim().split('\n').slice(-2).join(' | ').slice(0,250); }
 const sshMap={};if(ssh)for(const line of ssh.split('\n')){const [k,...v]=line.split(' ');sshMap[k]=v.join(' ')}
 const sshActive=await cmd('/usr/bin/systemctl',['is-active','ssh']);
 add('ssh','Remote access','SSH service',sshActive==='active'?'green':sshActive==='inactive'?'orange':'orange',sshActive||'Unknown','If SSH is required, confirm the service is running.');
 for(const [id,label,expected,advice] of [
  ['permitrootlogin','Root SSH login',['no'],'Disable root SSH login after verifying normal administrative access.'],
  ['passwordauthentication','SSH password authentication',['no'],'Use SSH keys and verify access before disabling passwords.'],
  ['kbdinteractiveauthentication','Keyboard-interactive SSH login',['no'],'Disable keyboard-interactive authentication if not required.'],
  ['x11forwarding','SSH X11 forwarding',['no'],'Disable X11 forwarding if unused.']]){
   const v=sshMap[id];add(id,'Remote access',label,!ssh?'orange':!v?'orange':expected.includes(v)?'green':'orange',v||('Unable to determine: '+(sshError||'sshd returned no value')),advice);
 }
 const auto=read('/etc/apt/apt.conf.d/20auto-upgrades');
 const upgrades=await cmd('/usr/bin/dpkg-query',['-W','-f=${Status}','unattended-upgrades']);
 add('unattended','Updates','Unattended upgrades',upgrades?.includes('install ok installed')?'green':'red',upgrades||'Not installed','Install and enable unattended-upgrades.');
 add('apt-periodic','Updates','Automatic update schedule',/APT::Periodic::Unattended-Upgrade\s+"[1-9]/.test(auto)&&/APT::Periodic::Update-Package-Lists\s+"[1-9]/.test(auto)?'green':'orange',auto.trim()||'No standard auto-upgrades file','Verify package-list refresh and unattended upgrade schedules.');
 const pending=await cmd('/usr/bin/apt',['list','--upgradable'],12000);
 const n=pending===null?null:pending.split('\n').filter(x=>x.includes('[upgradable from:')).length;
 add('pending','Updates','Pending package upgrades',n===null?'orange':n===0?'green':'orange',n===null?'Could not read cached APT list':n+' package(s) pending','Run apt update and review/install upgrades. Cached lists may be stale.');
 add('reboot','Updates','Reboot required',fs.existsSync('/var/run/reboot-required')?'orange':'green',fs.existsSync('/var/run/reboot-required')?'Yes':'No','Schedule a reboot after checking running services.');
 const caddy=await cmd('/usr/bin/systemctl',['is-active','caddy']);
 // Verify the actual HTTPS proxy without needing read access to the root-owned Caddyfile.
 const httpsHost=os.hostname().toLowerCase()+'.local';
 const httpsCheck=await new Promise(resolve=>{
   const req=https.get({hostname:'127.0.0.1',port:443,path:'/health',
     servername:httpsHost,rejectUnauthorized:false,timeout:4000,
     headers:{Host:httpsHost}},res=>{
       let body='';
       res.on('data',chunk=>{if(body.length<4096)body+=chunk.toString()});
       res.on('end',()=>{try{
         const health=JSON.parse(body);
         resolve(res.statusCode===200&&health.ok===true&&typeof health.app==='string');
       }catch{resolve(false)}});
     });
   req.on('timeout',()=>req.destroy(new Error('HTTPS timeout')));
   req.on('error',()=>resolve(false));
 });
 add('https','Web security','HTTPS reverse proxy',
   caddy==='active'&&httpsCheck?'green':'orange',
   caddy==='active'?(httpsCheck?'Active; HTTPS /health check passed':'Active; HTTPS /health check failed'):(caddy||'Caddy not running'),
   'Check HTTPS configuration in Advanced Settings and verify port 443 is reachable.');

 const listeners=await cmd('/usr/bin/ss',['-tlnH']);
 const public3000=listeners?.split('\n').some(x=>/\s(?:0\.0\.0\.0|\[::\]|\*):3000\s/.test(x));
 add('port3000','Web security','HTTP port 3000 exposed on all interfaces',listeners===null?'orange':public3000?'red':'green',listeners===null?'Cannot inspect listeners':public3000?'Port 3000 bound to all interfaces':'No all-interface port 3000 listener detected','Bind Node to 127.0.0.1 once HTTPS is verified, or restrict port 3000 by firewall.');
 const login=require('./wp-login').ensure();
 add('adminpass','Web security','Default administrator password',login.mustChange?'red':'green',login.mustChange?'Default credentials still enabled':'Changed','Change administrator credentials under WordPress Settings.');
 // UFW is a oneshot service: inactive (dead) is normal even with rules enabled.
 // Read the firewall's configured state without sudo, since status requires root.
 const ufwConfig=read('/etc/ufw/ufw.conf');
 const ufwDefault=read('/etc/default/ufw');
 const ufwEnabled=/^ENABLED=yes\\s*$/m.test(ufwConfig);
 const ufwInstalled=fs.existsSync('/usr/sbin/ufw');
 const ufwPolicy=(ufwDefault.match(/^DEFAULT_INPUT_POLICY="?(\\w+)"?/m)||[])[1];
 add('firewall','Network','UFW firewall',
   !ufwInstalled?'orange':!ufwConfig?'orange':ufwEnabled&&ufwPolicy==='DROP'?'green':'orange',
   !ufwInstalled?'UFW not installed':!ufwConfig?'UFW configuration not readable':ufwEnabled?'UFW enabled; incoming default '+(ufwPolicy||'unknown')+' (effective rules not verified)':'UFW disabled in configuration',
   'Verify effective firewall rules with sudo ufw status verbose.');
 const net=await cmd('/usr/bin/ss',['-tlnH']);
 add('listeners','Network','Listening TCP services',net===null?'orange':'green',net===null?'Unable to inspect':'Listening ports inspected','Review listening services and restrict unnecessary access.');
 const disk=fs.statfsSync?(()=>{try{const s=fs.statfsSync('/');return Math.round((1-s.bavail/s.blocks)*100)}catch{return null}})():null;
 add('disk','System','Root filesystem usage',disk===null?'orange':disk>=95?'red':disk>=85?'orange':'green',disk===null?'Unknown':disk+'% used','Free disk space or increase storage if necessary.');
 const sync=await cmd('/usr/bin/timedatectl',['show','-p','NTPSynchronized','--value']);
 add('ntp','System','Clock synchronisation',sync==='yes'?'green':'orange',sync||'Unknown','Enable and verify network time synchronisation.');
 const service=await cmd('/usr/bin/systemctl',['is-active','pi-network-monitor']);
 add('monitor','Application','Monitor service',service==='active'?'green':'red',service||'Unavailable','Check systemctl status pi-network-monitor.');
 const counts={green:0,orange:0,red:0};checks.forEach(c=>counts[c.level]++);
 return {checks,counts,checkedAt:new Date().toISOString(),hostname:os.hostname(),overall:counts.red?'red':counts.orange?'orange':'green',scope:'Read-only best-effort checks. Unknown results are amber; this is not a vulnerability scan or Cyber Essentials certification.'};
}
module.exports={scan};
