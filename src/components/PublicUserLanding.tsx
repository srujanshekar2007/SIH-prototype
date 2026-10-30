import { LogOut, ShieldCheck, UserRound } from 'lucide-react';

type Props = { profile: { display_name?: string|null; role?: string|null }; user: { email?: string|null; email_confirmed_at?: string|null }; onSignOut: () => void };

export default function PublicUserLanding({ profile, user, onSignOut }: Props) {
  const verified = Boolean(user.email_confirmed_at);
  return <main className="center-screen"><section className="panel public-account-card">
    <div className="brand-mark">A</div><span className="eyebrow">AICTE · PUBLIC ACCOUNT</span>
    <h1>Welcome{profile.display_name?.trim()?`, ${profile.display_name.trim()}`:''}</h1>
    <p>Your account is active with the restricted <b>Public User</b> role. This portal currently has no public case-submission feature, so complaint records, institution details, officer tools, and administrative pages are not available to this account.</p>
    <div className="security-status-list"><div className="session-current"><span className="status-live"/><div><b>{user.email||'Signed-in account'}</b><small>{verified?'Email verified':'Email verification may be required by this Supabase project'}</small></div></div><div className="session-current"><ShieldCheck size={17}/><div><b>Restricted access</b><small>Database policies continue to protect confidential records.</small></div></div><div className="session-current"><UserRound size={17}/><div><b>Role: Public User</b><small>Only an administrator can grant officer or administrative access.</small></div></div></div>
    <button className="button secondary" onClick={onSignOut}><LogOut size={15}/>Sign out</button>
  </section></main>;
}
