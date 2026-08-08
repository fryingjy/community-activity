import { StoppedError } from "../core/errors.js";

const REQUEST_DELAY_MS = 1500;

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new StoppedError());
    }, { once: true });
  });
}

export function waitLabel(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export class AdaptiveRateLimiter {
  constructor(minDelayMs = REQUEST_DELAY_MS) {
    this.minDelayMs = Math.max(300, minDelayMs);
    this.delayMs = this.minDelayMs;
  }

  success() {
    this.delayMs = Math.max(this.minDelayMs, this.delayMs * 0.98);
  }

  failure(multiplier = 1.5) {
    this.delayMs = Math.min(12000, this.delayMs * multiplier);
  }

  async wait(signal) {
    await delay(this.delayMs + Math.random() * this.delayMs * 0.08, signal);
  }
}
