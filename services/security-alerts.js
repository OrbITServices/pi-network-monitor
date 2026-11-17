const {getSettings}=require('./db');
const {sendMail}=require('./mailer');
const {scan}=require('./security-audit');
let timer=null,running=false,lastRun=null,lastError='',lastSent=null,lastSignature='';
function config(){const s=getSettings();return {enabled:s.security_alert_enabled==='true',hours:Math.max(1,Math.min(168,Number(s.security_alert_hours)||24)),minimum:['orange','red'].includes(s.security_alert_level)?s.security_alert_level:'red',changesOnly:s.security_alert_changes_only!=='false'};}
function selected(a,c){return a.checks.filter(x=>x.level==='red'||c.minimum==='orange'&&x.level==='orange')}
async function runNow({test=false}={}){
 if(running)throw Error('Security scan already running');
 running=true;
 try{
  const report=await scan();lastRun=report.checkedAt;
  const c=config(),issues=selected(report,c);
  const signature=issues.map(x=>x.id+':'+x.level).sort().join('|');
  const shouldSend=test||(c.enabled&&issues.length&&(!c.changesOnly||signature!==lastSignature));
  if(shouldSend){
   const subject='['+(report.overall.toUpperCase())+'] Security '+(test?'test ':'')+'report - '+report.hostname;
   const body=['Orb Pi Monitor security report',report.hostname,'Checked: '+report.checkedAt,'Summary: '+report.counts.green+' good, '+report.counts.orange+' needs work, '+report.counts.red+' needs fixing','',...issues.map(x=>x.level.toUpperCase()+' | '+x.label+' | '+x.detail+'\nAction: '+x.advice),'','Review: /settings/security','Automated best-effort checks; not a compliance certification.'].join('\n');
   await sendMail(subject,body);lastSent=new Date().toISOString();
  }
  if(!test){lastSignature=signature;}
  lastError='';
  return {report,sent:shouldSend,issues:issues.length};
 }catch(e){lastError=String(e.message||e);throw e}finally{running=false}
}
async function tick(){const c=config();if(!c.enabled||running)return;const due=!lastRun||Date.now()-Date.parse(lastRun)>=c.hours*3600000;if(due)try{await runNow()}catch(e){console.error('Security scheduled scan:',e.message)}}
function start(){if(timer)return;timer=setInterval(tick,60*1000);timer.unref();setTimeout(tick,10000).unref();}
function state(){return {...config(),lastRun,lastSent,lastError,running};}
module.exports={start,runNow,state};
