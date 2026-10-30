import { useState, type FormEvent } from 'react';
import { AlertTriangle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { publicRegistrationError, registerPublicAccount, validateRegistration } from '../lib/auth';
import { supabase } from '../lib/supabase';

type Mode = 'login' | 'signup' | 'forgot' | 'verify';

export default function AuthGate({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const switchMode = (next: Mode) => {
    if (next === 'login') {
      setFullName('');
      setEmail('');
      setPassword('');
      setConfirmation('');
      setShowPassword(false);
    }
    setMode(next);
    setError('');
    setMessage('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (!supabase) { setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'); return; }
    if (mode === 'signup') {
      const invalid = validateRegistration({ fullName, email, password, confirmPassword: confirmation });
      if (invalid) { setError(invalid); return; }
    } else if (!email.trim()) { setError('Enter your email address.'); return; }
    if (mode === 'login' && !password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else if (mode === 'signup') {
        const { data, error: signUpError } = await registerPublicAccount(supabase, { fullName, email, password, confirmPassword: confirmation }, window.location.origin);
        if (signUpError) throw signUpError;
        if (data?.session) {
          setMessage('Your account is ready. Opening your restricted public-user workspace…');
        } else {
          setMode('verify');
          setMessage('If this address can be registered, Supabase sent a verification email. Open the link to verify your address, then sign in.');
        }
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (resetError) throw resetError;
        setMessage('If an account uses this email address, a password reset link will be sent shortly.');
      }
    } catch (reason) {
      if (mode === 'signup') setError(publicRegistrationError(reason));
      else if (mode === 'login') setError('Sign-in failed. Check your email and password, then try again.');
      else setError('The request could not be completed. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const resendVerification = async () => {
    if (!supabase || !email.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: window.location.origin } });
      if (resendError) throw resendError;
      setMessage('If verification is still needed, Supabase sent a new email. Check your inbox and spam folder.');
    } catch { setError('A verification email could not be sent right now. Try again later.'); }
    finally { setBusy(false); }
  };

  const heading = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'verify' ? 'Check your email' : 'Welcome back';

  return <div className="login-screen"><div className="login-art"><div className="login-brand"><div className="brand-mark">A</div><b>AICTE</b></div><div className="login-art-copy"><span>INSTITUTIONAL GRIEVANCE MONITORING</span><h1>Clear visibility.<br/>Coordinated action.</h1><p>A secure workspace for authorized officials to monitor institution-related complaint cases.</p></div><div className="login-art-bottom">Integrated Complaint Monitoring System <span>·</span> Prototype</div></div><main className="login-main"><form key={mode} className="login-card" autoComplete="off" onSubmit={submit}>
    <div className="eyebrow">{mode === 'signup' ? 'PUBLIC ACCOUNT REGISTRATION' : mode === 'forgot' ? 'ACCOUNT RECOVERY' : mode === 'verify' ? 'EMAIL VERIFICATION' : 'SECURE PORTAL ACCESS'}</div>
    <h2>{heading}</h2>
    <p>{mode === 'signup' ? 'Create a basic account. It will not grant access to confidential complaint records or officer tools.' : mode === 'forgot' ? 'Request a secure password-reset link from Supabase Auth.' : mode === 'verify' ? 'Complete email verification if it is enabled for this Supabase project.' : 'Sign in to continue to the workspace allowed by your account role.'}</p>
    {!configured && <div className="notice warning compact"><AlertTriangle size={17}/><span>Connect Supabase to enable authentication.</span></div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="notice info compact" role="status"><ShieldCheck size={16}/><span>{message}</span></div>}
    {mode === 'signup' && <label>Full name<input autoComplete="name" type="text" maxLength={120} required value={fullName} onChange={event=>setFullName(event.target.value)} placeholder="Your full name"/></label>}
    {mode !== 'verify' && <label>Email address<input autoComplete="off" type="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></label>}
    {(mode === 'login' || mode === 'signup') && <label>Password<input autoComplete="new-password" type={showPassword?'text':'password'} minLength={mode==='signup'?12:1} maxLength={128} required value={password} onChange={event=>setPassword(event.target.value)} placeholder={mode==='signup'?'At least 12 characters':'Enter your password'}/></label>}
    {mode === 'signup' && <label>Confirm password<input autoComplete="new-password" type={showPassword?'text':'password'} minLength={12} maxLength={128} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="Enter the same password again"/></label>}
    {(mode === 'login' || mode === 'signup') && <label className="show-password"><input type="checkbox" checked={showPassword} onChange={event=>setShowPassword(event.target.checked)}/>{showPassword?<Eye size={14}/>:<EyeOff size={14}/>}Show password</label>}
    {mode === 'verify' ? <button type="button" className="button primary full" disabled={busy||!configured} onClick={()=>void resendVerification()}>{busy?'Sending…':'Resend verification email'}</button> : <button className="button primary full" disabled={busy||!configured}>{busy?mode==='signup'?'Creating account…':mode==='forgot'?'Requesting link…':'Signing in…':mode==='signup'?'Create account':mode==='forgot'?'Send reset link':'Sign in securely'}</button>}
    <div className="auth-switches">{mode === 'login' && <><button type="button" className="password-reset-link" onClick={()=>switchMode('forgot')}>Forgot your password?</button><span>New to the portal? <button type="button" className="text-button" onClick={()=>switchMode('signup')}>Create account</button></span></>}{mode === 'signup' && <span>Already registered? <button type="button" className="text-button" onClick={()=>switchMode('login')}>Return to login</button></span>}{(mode === 'forgot'||mode==='verify') && <button type="button" className="text-button" onClick={()=>switchMode('login')}>Return to login</button>}</div>
    <small className="login-note"><ShieldCheck size={14}/>{mode === 'signup'?'New accounts receive a restricted Public User role. Privileged access remains administrator-managed.':'Your access is controlled by your existing Supabase profile and database policies.'}</small>
  </form><div className="login-foot">Administrative monitoring prototype · Not an official AICTE deployment</div></main></div>;
}
