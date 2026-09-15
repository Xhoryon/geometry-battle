// 仅访问本探针新建的合成上传标记，绝不枚举已有上传或读取用户数据。
const fs=require('fs'), path=require('path'), os=require('os');
if (!process.env.GB_AUDIT_BASELINE) throw new Error('请显式指定隔离基线 GB_AUDIT_BASELINE');
const root = path.resolve(process.env.GB_AUDIT_BASELINE);
const {MatchSession}=require(path.join(root,'src/server/session'));
const {PY_ARGV_PRELUDE,PY_EMIT}=require(path.join(root,'tests/protocol-fixture'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gb-gate0-upload-'));
const created=[];
const original=fs.mkdtempSync;
const marker='GATE0_SYNTHETIC_MARKER_NOT_A_SECRET';
const source=PY_ARGV_PRELUDE+PY_EMIT+'with open(args.public) as f:\n    p=json.load(f)\nemit({"type":"number","value":p["emitters"][args.team]["y"]})\n';
const pack=text=>[{path:'solver.py',contentBase64:Buffer.from(text).toString('base64')}];
async function main(){
  let session;
  try{
    // 只记录本探针调用创建的上传目录，不读取父目录列表。
    fs.mkdtempSync=function(prefix,...args){const result=original.call(fs,prefix,...args);if(String(prefix).endsWith('gb-upload-'))created.push(result);return result;};
    session=new MatchSession({slotRoot:path.join(dir,'slots'),artifactRoot:path.join(dir,'artifacts'),sandboxRoot:path.join(dir,'sandboxes'),seed:20260909,pointCount:6,difficulty:'easy'});
    const b=await session.uploadPackage('B',pack('# '+marker+'\n'+source));
    const raw=created[0];
    if(!b.ok || !raw)throw Error('合成包安装或上传目录捕获失败');
    const target=path.join(raw,'solver.py');
    // 对该唯一已知文件做 read-only 验证：读失败时程序异常，安装 preflight 必失败。
    const reader='with open('+JSON.stringify(target)+') as f:\n    text=f.read(4096)\nassert '+JSON.stringify(marker)+' in text\n';
    const a=await session.uploadPackage('A',pack(reader+source));
    const result={syntheticOnly:true,uploadedB:b.ok,rawBRetained:fs.existsSync(target),teamAInstallationPreflightCanReadSyntheticB:a.ok,teamAErrors:a.errors,rawCopiesCreated:created.length};
    fs.writeFileSync(path.join(__dirname,'upload-boundary.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{fs.mkdtempSync=original;if(session)session.close();for(const p of created)fs.rmSync(p,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
