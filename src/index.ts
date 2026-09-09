/**
 * Geometry Battle V1 —— 公开 API
 *
 * 唯一正式比赛路径 (Canonical Match Pipeline)：
 *   MatchEngine  →  RoundMachine  →  SandboxRunner
 *                       ↑                 ↑
 *                 RoundState          Package (密封)
 *                       ↑                 ↑
 *              Ast / Validator        MapGenerator
 *                       ↑
 *                  Judge / Logs
 *
 * 旧版重复引擎（competition/*、function/DSL、judge/Judge、runner/AlgorithmRunner、
 * replay/ReplayLogger、submission/AlgorithmSubmission）已下线，
 * 以避免「Runner 输入 ≠ Judge 输入」这类根因再次出现。
 */

// ---- 场地 / 障碍 ----
export { Field, Point, FieldConfig, DEFAULT_FIELD_CONFIG } from './field/Field';
export {
  Obstacle,
  ObstacleType,
  SegmentObstacle,
  RectangleObstacle,
  CircleObstacle,
  PolygonObstacle,
  distanceToObstacle,
} from './obstacle/Obstacle';

// ---- 规则（唯一数值来源）----
export {
  FIELD,
  HIT_EPSILON,
  OBSTACLE_CONTACT_EPS,
  COMPUTE_TIMEOUT_MS,
  MEMORY_LIMIT_MB,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
  MIN_POINT_DISTANCE,
  POINT_COUNT_RANGE,
  DIFFICULTY_OBSTACLES,
  attackEndX,
  inTeamZone,
  firingDomain,
} from './core/Rules';

// ---- Canonical AST / Validator / Judge ----
export {
  CanonicalNode,
  CanonicalNodeType,
  FORBIDDEN_NODE_TYPES,
  LIMITS,
  AstIssue,
  ParseResult,
  parseCanonicalDSL,
  analyzeComplexity,
  evaluateNode,
  derivative1,
  derivative2,
  canonicalJson,
  hashNode,
  toMathString,
  analyzeRange,
  oscillationBound,
  absBound,
} from './core/Ast';
export {
  FunctionValidation,
  FunctionMetrics,
  detectJump,
  sampleStepFor,
  countConvexityChanges,
  validateAttackFunction,
} from './core/Validator';
export {
  ShotOutcome,
  TrajectoryPoint,
  TrajectoryEndReason,
  BlockInfo,
  penetration,
  traceTrajectory,
  judgeShot,
} from './core/Judge';

// ---- RoundState / Round 状态机 ----
export {
  AlivePoint,
  RoundStateCore,
  RunnerPayload,
  canonicalCoreJson,
  computeStateHash,
  toRunnerPayload,
  runnerPayloadJson,
  runnerPayloadWithoutTeamId,
} from './core/RoundState';
export { RoundPhase, PhaseTransition, RoundMachine } from './core/Round';

// ---- V1.1 两阶段输入协议 ----
export {
  PROTOCOL_VERSION,
  PublicStatePoint,
  BuiltInputFile,
  sha256Hex,
  buildPublicState,
  buildRevealState,
  roundStateHash,
  verifyRevealBinding,
  verifyPublicState,
  derivePreflightSeed,
} from './core/InputProtocol';

// ---- 地图 ----
export {
  GeneratedMap,
  MapConfig,
  MapValidation,
  generateMap,
  generateMapOrNull,
  tryGenerateMap,
  validateMap,
  computeMapHash,
  batchGenerateMaps,
  MAX_SEED_ATTEMPTS,
} from './map/MapGenerator';

// ---- 提交 / 密封 ----
export { Manifest, ManifestValidation, parseManifest } from './submission/Manifest';
export {
  PackageFile,
  PackageInspection,
  SealedPackage,
  hashFileList,
  inspectPackage,
  sealPackage,
  verifySeal,
} from './submission/Package';

// ---- 隔离运行器 ----
export {
  RunnerErrorCode,
  IsolationReport,
  RunnerOutcome,
  RunnerInput,
  DuelOptions,
  DuelResult,
  SpawnedRunner,
  PreparedSandbox,
  sandboxExecAvailable,
  prepareSandbox,
  spawnRunner,
  runDuel,
  cleanupSandbox,
  defaultSandboxRoot,
} from './runner/SandboxRunner';

// ---- 日志 / 审计 / 回放 ----
export {
  RoundLog,
  MatchLog,
  AuditEvent,
  AuditLog,
  ReplayFrame,
  Replay,
  MatchArtifacts,
  AuditRecorder,
  simplifyTrajectory,
  persistArtifacts,
  loadReplay,
} from './core/Logs';

// ---- 比赛编排 ----
export {
  MatchEngine,
  MatchEngineError,
  MatchPhase,
  MatchOptions,
  MatchSnapshot,
  PointState,
  RoundResult,
  generateMatchId,
} from './core/Match';

// ---- UI 接线 ----
export { MatchSetupUI, MatchSetupState } from './ui/MatchSetupUI';
export { TeamControllerUI, JudgeControllerUI, ShooterSelectionState } from './ui/TeamControllerUI';
export { AudienceScreenUI, MatchResultSummary } from './ui/AudienceScreenUI';
export {
  AudienceState,
  VisualizerConfig,
  DEFAULT_VISUALIZER_CONFIG,
  formatAudienceState,
  sampleFunctionPoints,
  mathToCanvas,
  canvasToMath,
  pointsToSvgPath,
} from './visualizer/AudienceDisplay';
