import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bell, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { CaseRow } from '../lib/supabase';
import { getDeadlineNotifications, type DeadlineNotification } from '../lib/notifications';

type NotificationBellProps = {
  cases: CaseRow[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpenCase: (caseNumber: string) => void;
};

type Filter = 'All' | 'Overdue' | 'Due Soon';

export default function NotificationBell({ cases, loading, error, onRetry, onOpenCase }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState(false);
  const [filter, setFilter] = useState<Filter>('All');
  const [now, setNow] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const notifications = useMemo(() => getDeadlineNotifications(cases, now), [cases, now]);
  const visibleNotifications = useMemo(() => filter === 'All'
    ? notifications
    : notifications.filter((item) => item.kind === (filter === 'Overdue' ? 'overdue' : 'due-soon')),
  [filter, notifications]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const mobileBreakpoint = window.matchMedia('(max-width: 760px)');
    const closeMobilePageOnDesktop = () => {
      if (!mobileBreakpoint.matches) setMobilePage(false);
    };
    mobileBreakpoint.addEventListener('change', closeMobilePageOnDesktop);
    return () => mobileBreakpoint.removeEventListener('change', closeMobilePageOnDesktop);
  }, []);

  useEffect(() => {
    if (!open && !mobilePage) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (open && event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setMobilePage(false); }
    };
    if (open) document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, mobilePage]);

  useEffect(() => {
    if (!mobilePage) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBody = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    const previousRootOverflow = root.style.overflow;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    return () => {
      body.style.position = previousBody.position;
      body.style.top = previousBody.top;
      body.style.left = previousBody.left;
      body.style.right = previousBody.right;
      body.style.width = previousBody.width;
      body.style.overflow = previousBody.overflow;
      root.style.overflow = previousRootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [mobilePage]);

  const counts = {
    All: notifications.length,
    Overdue: notifications.filter((item) => item.kind === 'overdue').length,
    'Due Soon': notifications.filter((item) => item.kind === 'due-soon').length,
  };

  const openNotification = (item: DeadlineNotification) => {
    setOpen(false);
    setMobilePage(false);
    onOpenCase(item.case.case_number);
  };

  const handleTriggerClick = () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setOpen(false);
      setMobilePage(true);
      return;
    }
    setOpen((value) => !value);
  };

  return <div className="notification-bell" ref={rootRef}>
    <button
      type="button"
      className="icon-btn notification-bell-trigger"
      aria-label={`Case notifications, ${notifications.length} cases require attention`}
      aria-haspopup="dialog"
      aria-expanded={open || mobilePage}
      aria-controls={mobilePage ? 'case-notifications-mobile-page' : 'case-notifications-panel'}
      onClick={handleTriggerClick}
    >
      <Bell size={17}/>
      {notifications.length > 0 && <span className="notification-count" aria-hidden="true">{notifications.length}</span>}
    </button>

    {open && <section className="notification-panel" id="case-notifications-panel" role="dialog" aria-label="Case Notifications">
      <header className="notification-panel-header">
        <div><h2>Case Notifications</h2><p>{notifications.length} case{notifications.length === 1 ? '' : 's'} require attention</p></div>
        <button type="button" className="icon-btn notification-close" aria-label="Close notifications" onClick={() => setOpen(false)}>×</button>
      </header>

      <div className="notification-filters" role="tablist" aria-label="Filter notifications">
        {(['All', 'Overdue', 'Due Soon'] as const).map((item) => <button
          type="button"
          key={item}
          role="tab"
          aria-selected={filter === item}
          className={filter === item ? 'is-selected' : ''}
          onClick={() => setFilter(item)}
        >{item}<span>{counts[item]}</span></button>)}
      </div>

      <div className="notification-list" aria-live="polite">
        {loading ? <div className="notification-state"><span className="spinner small"/>Loading case deadlines…</div>
          : error ? <div className="notification-state notification-error" role="alert"><p>{error}</p><button type="button" className="button secondary" disabled={loading} onClick={onRetry}><RefreshCw size={14}/> Retry</button></div>
            : visibleNotifications.length ? visibleNotifications.map((item) => <NotificationRow key={item.case.id} item={item} now={now} onClick={() => openNotification(item)}/>)
              : <div className="notification-state">{notifications.length === 0 ? 'No cases require immediate attention.' : `No ${filter.toLowerCase()} cases.`}</div>}
      </div>
    </section>}
    {mobilePage && createPortal(
      <section className="notification-mobile-page" id="case-notifications-mobile-page" aria-label="Case Notifications">
        <header className="notification-mobile-header">
          <button type="button" className="notification-back" onClick={() => setMobilePage(false)}><ArrowLeft size={19} aria-hidden="true"/> Back</button>
          <div><h1>Case Notifications</h1><p>{notifications.length} case{notifications.length === 1 ? '' : 's'} require attention</p></div>
        </header>
        <div className="notification-filters" role="tablist" aria-label="Filter notifications">
          {(['All', 'Overdue', 'Due Soon'] as const).map((item) => <button
            type="button"
            key={item}
            role="tab"
            aria-selected={filter === item}
            className={filter === item ? 'is-selected' : ''}
            onClick={() => setFilter(item)}
          >{item}<span>{counts[item]}</span></button>)}
        </div>
        <div className="notification-list notification-mobile-list" aria-live="polite">
          {loading ? <div className="notification-state"><span className="spinner small"/>Loading case deadlines…</div>
            : error ? <div className="notification-state notification-error" role="alert"><p>{error}</p><button type="button" className="button secondary" disabled={loading} onClick={onRetry}><RefreshCw size={14}/> Retry</button></div>
              : visibleNotifications.length ? visibleNotifications.map((item) => <NotificationRow key={item.case.id} item={item} now={now} onClick={() => openNotification(item)}/>)
                : <div className="notification-state">{notifications.length === 0 ? 'No cases require immediate attention.' : `No ${filter.toLowerCase()} cases.`}</div>}
        </div>
      </section>,
      document.body,
    )}
  </div>;
}

function NotificationRow({ item, now, onClick }: { item: DeadlineNotification; now: Date; onClick: () => void }) {
  const label = item.kind === 'overdue' ? overdueLabel(item.deadlineMs, now.getTime()) : dueSoonLabel(item.deadlineMs, now.getTime());
  const deadline = new Date(item.deadlineMs).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const institution = item.case.institutions?.name || 'Institution not recorded';
  const subject = item.case.subject?.trim() || 'Subject not recorded';

  return <button type="button" className="notification-item" onClick={onClick}>
    <span className={`notification-indicator ${item.kind}`}>{item.kind === 'overdue' ? 'Overdue' : 'Due Soon'}</span>
    <span className="notification-case">{item.case.case_number}</span>
    <strong>{subject}</strong>
    <span className="notification-institution">{institution}</span>
    <span className="notification-details"><span className={`notification-status ${item.case.status.toLowerCase().replaceAll(' ', '-')}`}>{item.case.status}</span><span>{label}</span></span>
    <span className="notification-deadline">Deadline · {deadline}</span>
  </button>;
}

function overdueLabel(deadlineMs: number, nowMs: number) {
  const days = Math.max(1, Math.ceil((nowMs - deadlineMs) / (24 * 60 * 60 * 1000)));
  return `${days} day${days === 1 ? '' : 's'} overdue`;
}

function dueSoonLabel(deadlineMs: number, nowMs: number) {
  const hours = Math.max(0, Math.ceil((deadlineMs - nowMs) / (60 * 60 * 1000)));
  if (hours === 0) return 'Due in less than 1 hour';
  if (hours < 24) return `Due in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) return `Due in ${days} day${days === 1 ? '' : 's'}`;
  return `Due in ${days}d ${remainingHours}h`;
}
