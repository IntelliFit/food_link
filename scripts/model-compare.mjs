// Read only the three provider credentials from the project server, then pipe
// them into the isolated Go diagnostic. No credential files or browser keys.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const remoteRead = `import base64,hashlib,hmac,json,subprocess,time,urllib.request,urllib.parse,yaml
kube=['sudo','-n','kubectl','--kubeconfig=/etc/kubernetes/admin.conf']
secret=json.loads(subprocess.check_output(kube+['-n','default','get','secret','foodlink-main-apollo-config','-o','json']))
b=yaml.safe_load(base64.b64decode(secret['data']['apollo-config.yaml']))['apollo']
app=b.get('appid') or b.get('app_id'); cluster=b.get('cluster','default'); ns=b.get('namespaces',['app-config.yaml'])[0]
p='/configs/{}/{}/{}'.format(app,cluster,urllib.parse.quote(ns,safe='')); stamp=str(int(time.time()*1000))
sig=base64.b64encode(hmac.new(b['access_key_secret'].encode(),(stamp+'\\n'+p).encode(),hashlib.sha1).digest()).decode()
svc=json.loads(subprocess.check_output(kube+['-n','apollo','get','service','apollo-configservice','-o','json']))
url='http://{}:{}{}'.format(svc['spec']['clusterIP'],svc['spec']['ports'][0]['port'],p)
r=urllib.request.Request(url,headers={'Authorization':'Apollo '+app+':'+sig,'Timestamp':stamp})
with urllib.request.urlopen(r,timeout=20) as response: payload=json.load(response)
values=payload['configurations']; cfg=yaml.safe_load(values.get('content','')) or {}; ext=cfg.get('external',{})
for k,v in values.items():
 if k.startswith('external.'): ext[k.split('.',1)[1]]=v
mapping={'ofoxai_api_key':'OfoxAIAPIKey','ofoxai_base_url':'OfoxAIBaseURL','gemini35_api_key':'Gemini35APIKey','gemini35_base_url':'Gemini35BaseURL','openlux_api_key':'OpenLuxAPIKey','openlux_base_url':'OpenLuxBaseURL','a6_api_key':'A6APIKey','a6_base_url':'A6BaseURL'}
print(json.dumps({dest:ext.get(src,'') for src,dest in mapping.items()}))
`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const openPage = process.argv.includes('--open');
const flags = process.argv.slice(2).filter(arg=>arg !== '--open');
if (flags.includes('--help')) {
  console.log('node scripts/model-compare.mjs [--open] [-check-image 绝对图片路径] [-prompt 自己的问题] [-protocol native|compat] [-timeout 90s]');
  process.exit(0);
}
const fetched = spawnSync('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=15','ubuntu@154.8.205.78','python3 -'], { input: remoteRead, encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 128 << 10 });
if (fetched.status !== 0) { console.error('只读读取三渠道配置失败（SSH/Apollo），未开始任何模型调用。'); process.exit(1); }
let credentials;
try { credentials = JSON.parse(fetched.stdout); } catch { console.error('配置响应格式无效，未开始模型调用。'); process.exit(1); }
const child = spawn('go', ['run','./cmd/model-compare','-credentials-stdin',...flags], {cwd:path.join(root,'backend'),stdio:['pipe','inherit','pipe'],windowsHide:true});
let opened = false, stderrTail = '';
child.stderr.on('data', chunk=> {
  process.stderr.write(chunk);
  stderrTail = (stderrTail+chunk.toString()).slice(-4096);
  if(openPage && !opened && stderrTail.includes('对比页面已就绪：http://127.0.0.1:38915')) {
    opened=true;
    const browser = spawn('cmd.exe',['/c','start','','http://127.0.0.1:38915'],{windowsHide:true,stdio:'ignore'});
    browser.on('error',()=>console.error('请手动打开 http://127.0.0.1:38915'));
  }
});
child.stdin.end(JSON.stringify(credentials)+'\n');
credentials = null;
child.on('error', () => { console.error('无法运行Go对比工具'); process.exitCode=1; });
child.on('exit', code => { process.exitCode=code ?? 1; });
