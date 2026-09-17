import type { AppEvent, EventDetails, EventHandler, EventRoom } from "../src/core/events/index.js";
import type { CliOptions, CliTarget } from "../src/cli/cli.js";
import type { AdminDashboardProps, Job, JobListProps, LiveEventListener, UiRecord } from "../src/ui/react/index.js";

const details: EventDetails = { audience: { userId: "user-1" }, count: 1 };
const event: AppEvent = { id: "event-1", who: "system", what: "test", where: "tests", when: new Date().toISOString(), details };
const handler: EventHandler = async (received) => received;
const room: EventRoom = "user:user-1";
const target: CliTarget = "staging";
const options: Pick<CliOptions, "target" | "json"> = { target, json: true };
const job: Job = { id: "job-1", type: "test", status: "queued" };
const record: UiRecord = { id: "record-1", status: "green" };
const dashboard: AdminDashboardProps = { initialSection: "jobs", onSectionChange: (selection) => selection.key };
const list: JobListProps = { filters: { status: "queued", limit: 20 } };
const listener: LiveEventListener = (received) => received.id;

void [event, handler, room, options, job, record, dashboard, list, listener];
