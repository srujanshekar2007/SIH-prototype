import { ArrowRight, ShieldCheck } from 'lucide-react';
import BrandLogo from './BrandLogo';

export default function LaunchPage({ onStart }: { onStart: () => void }) {
  return (
    <main className="launch-screen">
      <header className="launch-brand">
        <BrandLogo />
        <span><b>SYNAPSE</b><small>CASE MONITORING</small></span>
      </header>
      <section className="launch-content" aria-labelledby="launch-title">
        <span className="launch-eyebrow">INSTITUTIONAL GRIEVANCE MONITORING</span>
        <h1 id="launch-title">Clear visibility.<br/>Coordinated action.</h1>
        <p>A secure workspace for authorized officials to monitor institution-related complaint cases.</p>
        <button className="button primary launch-start" type="button" onClick={onStart}>
          Get started <ArrowRight size={17} aria-hidden="true" />
        </button>
        <div className="launch-security"><ShieldCheck size={16} aria-hidden="true"/> Secure access for authorized users</div>
      </section>
      <footer className="launch-footer">Integrated Complaint Monitoring System <span>·</span> Prototype</footer>
    </main>
  );
}
