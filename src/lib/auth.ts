export type RegistrationInput = { fullName: string; email: string; password: string; confirmPassword: string };

export function validateRegistration(input: RegistrationInput): string | null {
  if (!input.fullName.trim()) return 'Enter your full name.';
  if (input.fullName.trim().length > 120) return 'Your name must be 120 characters or fewer.';
  const email = input.email.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (input.password.length < 12) return 'Use a password with at least 12 characters.';
  if (input.password.length > 128) return 'Use a password with no more than 128 characters.';
  if (input.password !== input.confirmPassword) return 'The passwords do not match.';
  return null;
}

export function publicRegistrationError(error: unknown): string {
  const item = error as { code?: unknown; message?: unknown } | null;
  const code = typeof item?.code === 'string' ? item.code.toLowerCase() : '';
  const message = typeof item?.message === 'string' ? item.message.toLowerCase() : '';
  if (code === 'user_already_exists' || /already (registered|exists)|user already/.test(message)) {
    return 'An account already uses this email. Try signing in or requesting a password reset.';
  }
  if (code === 'weak_password' || /password.*(weak|short|characters)/.test(message)) {
    return 'Choose a stronger password with at least 12 characters.';
  }
  if (code === 'email_address_invalid' || /invalid email/.test(message)) return 'Enter a valid email address.';
  if (code === 'over_email_send_rate_limit') return 'Too many verification emails were requested. Wait a while, then try again.';
  return 'Account registration could not be completed. Check your connection and try again.';
}

export async function registerPublicAccount(client: any, input: RegistrationInput, redirectTo: string) {
  const validation = validateRegistration(input);
  if (validation) return { data: null, error: new Error(validation) };
  return client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { full_name: input.fullName.trim() },
      emailRedirectTo: redirectTo,
    },
  });
}
