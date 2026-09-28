import type { EmailSender } from "./email";

interface EmailUser {
  email: string;
  name?: string | null;
}

function greeting(user: EmailUser) {
  return user.name ? `Hello ${user.name},` : "Hello,";
}

/**
 * Better Auth email settings. Without a sender (local development and
 * tests) accounts need no verification and password reset is unavailable.
 * With one, sign-in requires a verified email, verification and reset
 * links are emailed, and a reset signs out every existing session.
 */
export function authEmailOptions(sender: EmailSender | undefined) {
  if (!sender) {
    return {
      emailAndPassword: { requireEmailVerification: false },
    } as const;
  }
  return {
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: EmailUser;
        url: string;
      }) => {
        await sender.send({
          to: user.email,
          subject: "Verify your IssueRelay email",
          text: `${greeting(user)}\n\nConfirm your email address for the IssueRelay dashboard:\n${url}\n\nIf you did not expect this, ignore this email.`,
        });
      },
    },
    emailAndPassword: {
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: EmailUser;
        url: string;
      }) => {
        await sender.send({
          to: user.email,
          subject: "Reset your IssueRelay password",
          text: `${greeting(user)}\n\nReset your IssueRelay dashboard password (the link expires in one hour):\n${url}\n\nIf you did not ask for this, ignore this email; your password is unchanged.`,
        });
      },
    },
  };
}
