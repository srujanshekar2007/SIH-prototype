import { describe, expect, it, vi } from 'vitest';
import { publicRegistrationError, registerPublicAccount, validateRegistration } from '../auth';

const valid = { fullName: 'A Public User', email: 'visitor@example.test', password: 'long-secure-password', confirmPassword: 'long-secure-password' };

describe('public account registration', () => {
  it('validates name, email, password strength, length, and confirmation', () => {
    expect(validateRegistration(valid)).toBeNull();
    expect(validateRegistration({ ...valid, fullName: ' ' })).toContain('full name');
    expect(validateRegistration({ ...valid, email: 'bad-email' })).toContain('valid email');
    expect(validateRegistration({ ...valid, password: 'short', confirmPassword: 'short' })).toContain('12 characters');
    expect(validateRegistration({ ...valid, password: 'long-secure-password', confirmPassword: 'different-password' })).toContain('do not match');
  });

  it('requests Supabase Auth account creation with name metadata only; database trigger owns role assignment', async () => {
    const signUp = vi.fn(async (_input: unknown) => ({ data: { user: { id: 'auth-user' }, session: null }, error: null }));
    const result = await registerPublicAccount({ auth: { signUp } }, valid, 'https://portal.example.test');
    expect(result.error).toBeNull();
    expect(signUp).toHaveBeenCalledWith({
      email: valid.email,
      password: valid.password,
      options: { data: { full_name: valid.fullName }, emailRedirectTo: 'https://portal.example.test' },
    });
    expect(JSON.stringify(signUp.mock.calls[0][0])).not.toContain('role');
  });

  it('does not call Supabase for invalid input and maps duplicate-email errors safely', async () => {
    const signUp = vi.fn();
    const result = await registerPublicAccount({ auth: { signUp } }, { ...valid, confirmPassword: 'mismatch' }, '/');
    expect(result.error?.message).toContain('do not match');
    expect(signUp).not.toHaveBeenCalled();
    expect(publicRegistrationError({ code: 'user_already_exists' })).toContain('already uses this email');
  });
});
