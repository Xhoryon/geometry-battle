// 使用临时槽位与已知良性包验证会话投影，不创建正式赛事产物或修改源码。
const fs = require('fs');
const path = require('path');
const os = require('os');
if (!process.env.GB_AUDIT_BASELINE) throw new Error('请显式指定隔离基线 GB_AUDIT_BASELINE');
const root = path.resolve(process.env.GB_AUDIT_BASELINE);
const { MatchSession } = require(path.join(root, 'src/server/session'));
const { spawnSync } = require('child_process');
const observations = {};
function makeSession(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-gate0-session-'));
  const slotRoot = path.join(dir, 'slots');
  for (const [team, fixture] of [['a','arc-sweep'],['b','parabola-arc']]) {
    fs.cpSync(path.join(root, 'tests/fixtures/algos', fixture), path.join(slotRoot, 'team-'+team), { recursive: true });
  }
  const session = new MatchSession({ slotRoot, artifactRoot: path.join(dir,'artifacts'), sandboxRoot: path.join(dir,'sandboxes'), seed: 20260909, pointCount: 6, difficulty: 'easy', tournamentMode: true });
  return {dir,session};
}
async function main() {
  let test = makeSession('partial');
  try {
    const first = await test.session.useSlot('A');
    const before = test.session.getBoard('judge');
    const action = before.actions.find(a=>a.key==='prepare');
    const result = await test.session.prepareMatch();
    observations.partialPrepare = { firstOk:first.ok, phase:before.phase, enabled:action?.enabled, result };
  } finally { test.session.close(); fs.rmSync(test.dir,{recursive:true,force:true}); }
  test = makeSession('normal');
  try {
    const prepare = await test.session.prepareMatch();
    const spectator = test.session.getBoard('spectator');
    observations.preReveal = { prepareOk:prepare.ok, phase:spectator.phase, round:spectator.round, obstacles:spectator.arena?.obstacles?.length, teamAPhase:test.session.getBoard('team-a').phase };
  } finally { test.session.close(); fs.rmSync(test.dir,{recursive:true,force:true}); }
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-gate0-cli-'));
  try {
    const result = spawnSync(process.execPath, ['-r',path.join(root,'node_modules/ts-node/register'),path.join(root,'src/operator/judge.ts'),'--slots',path.join(cliDir,'slots'),'--artifacts',path.join(cliDir,'artifacts'),'--seed','20260909','--points','6','--difficulty','easy','--no-anim'], {cwd:root,input:'v\ns\nq\n',encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    const output = result.stdout || '';
    observations.interactiveJudge = { exitCode:result.status, autoFlag:false, suppliedPackages:false, temporarySlotsSeeded:fs.existsSync(path.join(cliDir,'slots/team-a/solver.py')), startedMessage:output.includes('比赛已开始'), readyShown:output.includes('READY'), autoSelectedEventShown:output.includes('EmitterAutoSelected') };
    fs.writeFileSync(path.join(__dirname,'interactive-judge.log'),output.replaceAll(cliDir,'<TEMP>').replaceAll(root,'<BASELINE>'));
  } finally {fs.rmSync(cliDir,{recursive:true,force:true});}
  fs.writeFileSync(path.join(__dirname,'session-probes.json'),JSON.stringify(observations,null,2)+'\n');
  console.log(JSON.stringify(observations,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
