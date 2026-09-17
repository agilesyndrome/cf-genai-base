import { AppDomain } from "../../domain/index.js";
import type { DataResourceInput } from "../../data/model.js";
import { MESSAGING_DATA_RESOURCES } from "./resources.js";

/** Messaging persistence belongs to the concept even when the host supplies its API routes. */
export class MessagingDomain extends AppDomain {
  constructor(options: { dataResources?: readonly DataResourceInput[] } = {}) {
    super({
      name: "messaging.messages",
      basePath: "/api/messages",
      auth: "user",
      dataResources: options.dataResources ?? MESSAGING_DATA_RESOURCES,
    });
  }
}
