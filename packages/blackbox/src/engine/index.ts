export { EvidenceEngine, evidenceEngine, type EvidenceSet } from "./engine.js";

export { scoreCandidates, outcomeFor, POINTS_PER_SIGNAL, MAX_SCORE, LIKELY_ROOT_CAUSE_MIN, NO_CLEAR_MIN } from "./scoring.js";
export { buildChain, filesInWindow, findLastHealthyEvent, findFirstFailureEvent, findErrorEvent, isBuildEvent, getBuildExitCode, type EvidenceChain } from "./evidence.js";
