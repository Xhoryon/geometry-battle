/**
 * 几何斗殴 - AI Vibecoding 函数图像比赛
 * V1 Platform - Plan 2 完成版
 */

// 导出所有模块
export { Field, Point, FieldConfig, DEFAULT_FIELD_CONFIG } from './field/Field';
export { Obstacle, ObstacleType, SegmentObstacle, RectangleObstacle, CircleObstacle, PolygonObstacle } from './obstacle/Obstacle';
export { FunctionGraph } from './function/FunctionGraph';
export { Competition, Team, RoundState, CompetitionResult, RoundResult } from './competition/Competition';
export { MatchController, MatchPhase, MatchState, MatchConfig } from './competition/MatchController';
export { RoundStateMachine, RoundPhase, ShotResult } from './competition/StateMachine';
export {
  ASTNode,
  ASTNodeType,
  parseDSL,
  evaluateAST,
  checkContinuity,
  countConvexityChanges,
  analyzeComplexity,
  astToString
} from './function/DSL';
export { Manifest, ManifestValidation, parseManifest } from './submission/Manifest';
export { AlgorithmSubmission, SubmissionStatus, computePackageHash, validatePackage } from './submission/AlgorithmSubmission';
export { runAlgorithm, RoundStateForRunner, RunnerResult, RunnerConfig, DEFAULT_RUNNER_CONFIG } from './runner/AlgorithmRunner';
export { generateMap, GeneratedMap, MapConfig, validateMap, batchGenerateMaps } from './map/MapGenerator';
export { MatchLogger, AuditLogger, ReplayGenerator, MatchLog, RoundLog, AuditLog, computeFunctionHash, generateMatchId } from './replay/ReplayLogger';

import { parseDSL, evaluateAST, countConvexityChanges, analyzeComplexity, astToString } from './function/DSL';
import { RoundStateMachine } from './competition/StateMachine';
import { generateMap, validateMap } from './map/MapGenerator';
import { MatchController } from './competition/MatchController';

// 示例 DSL 公式 (嵌套结构保证每个二元操作只有2个参数)
const dslA = JSON.stringify({
  type: 'add',
  args: [
    {
      type: 'add',
      args: [
        { type: 'mul', args: [{ type: 'number', value: 0.3 }, { type: 'variable', value: 'x' }] },
        { type: 'sin', args: [{ type: 'mul', args: [{ type: 'number', value: 0.7 }, { type: 'variable', value: 'x' }] }] }
      ]
    },
    { type: 'number', value: 1.4 }
  ]
});

const dslB = JSON.stringify({
  type: 'add',
  args: [
    { type: 'mul', args: [{ type: 'number', value: 0.2 }, { type: 'variable', value: 'x' }] },
    { type: 'cos', args: [{ type: 'mul', args: [{ type: 'number', value: 0.5 }, { type: 'variable', value: 'x' }] }] }
  ]
});

// V1 演示
console.log('几何斗殴 - V1 Platform (Plan 2)');
console.log('='.repeat(50));

// DSL 解析
console.log('\n[DSL 解析]');
const resultA = parseDSL(dslA);
console.log('Team A DSL:', resultA.valid ? '有效' : '无效');
console.log('  公式:', resultA.ast ? astToString(resultA.ast) : 'N/A');

const resultB = parseDSL(dslB);
console.log('Team B DSL:', resultB.valid ? '有效' : '无效');
console.log('  公式:', resultB.ast ? astToString(resultB.ast) : 'N/A');

// 复杂度分析
if (resultA.ast) {
  const complexity = analyzeComplexity(resultA.ast);
  console.log('\n[复杂度分析 - Team A]');
  console.log('  节点数:', complexity.nodeCount, '(限制 128)');
  console.log('  深度:', complexity.depth, '(限制 12)');
}

// 凸性变化检测
if (resultA.ast) {
  const convexity = countConvexityChanges(resultA.ast, -20, -4);
  console.log('\n[凸性变化 - Team A]');
  console.log('  变化次数:', convexity.count, '(限制 100)');
}

// 函数求值
if (resultA.ast) {
  console.log('\n[函数求值 - Team A]');
  console.log('  x=-14 时, y=', evaluateAST(resultA.ast, -14).toFixed(4));
  console.log('  x=-10 时, y=', evaluateAST(resultA.ast, -10).toFixed(4));
}

// Round 状态机演示
console.log('\n[Round 状态机演示]');
const sm = new RoundStateMachine(1, []);
console.log('初始阶段:', sm.getState().phase);

const lockA = sm.setShooter('A', 'A1', dslA);
console.log('A 锁定:', lockA, '- 阶段:', sm.getState().phase);

const lockB = sm.setShooter('B', 'B1', dslB);
console.log('B 锁定:', lockB, '- 阶段:', sm.getState().phase);

sm.judgeApprove();
console.log('Judge 确认 - 阶段:', sm.getState().phase);

// 地图生成演示
console.log('\n[地图生成演示]');
const map = generateMap({ seed: 12345, pointCount: 8, difficulty: 'medium' });
console.log('  Seed:', map.seed);
console.log('  Team A 点数:', map.teamA.length);
console.log('  Team B 点数:', map.teamB.length);
console.log('  障碍物数量:', map.obstacles.length);
console.log('  State Hash:', map.stateHash);

const validation = validateMap(map);
console.log('  地图验证:', validation.valid ? '通过' : '失败');
if (validation.errors.length > 0) {
  console.log('  错误:', validation.errors);
}

// Match Controller 演示
console.log('\n[Match Controller 演示]');
const match = new MatchController('Alpha', 'Beta', 12345);
console.log('  Match ID:', match.getState().config.matchId);
console.log('  Phase:', match.getPhase());

console.log('\n═══════════════════════════════════════════════════════');
console.log('           V1 Platform 已就绪！');
console.log('═══════════════════════════════════════════════════════');
console.log('\n核心功能:');
console.log('  ✓ DSL/AST 解析与验证');
console.log('  ✓ 函数连续性/凸性检测');
console.log('  ✓ 17 阶段 Round 状态机');
console.log('  ✓ 确定性地图生成');
console.log('  ✓ Algorithm Runner 隔离执行');
console.log('  ✓ Match 日志与 Replay');
console.log('  ✓ Audience UI 状态显示');
console.log('  ✓ 动画帧生成');
