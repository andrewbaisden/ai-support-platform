export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication is required");
  }
}

export class AuthForbiddenError extends Error {
  constructor() {
    super("Access to this workspace is forbidden");
  }
}

export class AuthMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
  }
}
