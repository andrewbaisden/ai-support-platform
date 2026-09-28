/** Password reset needs account email (Resend) configured on the server. */
export function passwordResetAvailable(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim(),
  );
}
