import type { MacroNeedsUserInputPayload, MacroValue } from './runtime-types.js';

export class MacroRuntimeError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroRuntimeError';
  }
}

export class MacroCancellationError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly atSafePoint: string
  ) {
    super('Macro cancelled');
    this.name = 'MacroCancellationError';
  }
}

export class MacroExitError extends Error {
  constructor(
    public readonly value: MacroValue,
    public readonly line?: number
  ) {
    super('macro exited');
    this.name = 'MacroExitError';
  }
}

export class MacroFailError extends Error {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(message);
    this.name = 'MacroFailError';
  }
}

export class MacroNeedsUserInputError extends Error {
  constructor(
    public readonly payload: MacroNeedsUserInputPayload,
    public readonly line?: number
  ) {
    super('macro needs user input');
    this.name = 'MacroNeedsUserInputError';
  }
}

export class MacroExpectedError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly details?: object
  ) {
    super(message);
    this.name = 'MacroExpectedError';
  }
}
