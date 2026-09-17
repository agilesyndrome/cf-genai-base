export class LLMCircuitBreakerError extends Error {
  readonly code = "circuit_breaker_open";
  readonly circuitBreakerOpen = true;

  constructor(message: string = "LLM generation is temporarily unavailable") {
    super(message);
    this.name = "LLMCircuitBreakerError";
  }
}

export class LLMResponseError<ResponsePayload = unknown> extends Error {
  readonly code = "response_failed";
  readonly responseFailed = true;
  readonly llmResponse: ResponsePayload;

  constructor(message: string, llmResponse: ResponsePayload, cause?: unknown) {
    super(message, { cause });
    this.name = "LLMResponseError";
    this.llmResponse = llmResponse;
  }
}
