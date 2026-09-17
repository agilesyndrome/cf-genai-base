import { coreCircuitBreakers } from "./circuits/domain.js";
import { coreHealthchecks } from "./healthchecks/domain.js";
import { coreJobs } from "./jobs/domain.js";
import { coreLiveEvents } from "./events/domain.js";
export const CORE_DOMAINS = [coreHealthchecks, coreCircuitBreakers, coreJobs, coreLiveEvents] as const;
